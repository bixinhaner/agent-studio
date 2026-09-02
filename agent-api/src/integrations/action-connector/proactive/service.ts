import { Prisma, type PrismaClient } from "@prisma/client";

import { ActionConnectorRuntimeService, type ActionConnectorCodexRunner, type AgentStreamEvent } from "../runtime.js";
import type { IntegrationInstanceRepositoryDb } from "../../../persistence/integration-instance-repository.js";
import { actionConnectorConfigSchema } from "../../center/action-connector-adapter.js";
import { connectorEventSchema, findingSchema, XOMC_PACKAGE, type ConnectorEventEnvelope } from "./contracts.js";
import { DurableActionConnectorToolBridge } from "./durable-tool-bridge.js";
import { resourcesWithinScope, type ScenarioSpec } from "./scenario-catalog.js";
import { ProactiveScenarioRegistry } from "./scenario-registry.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strictJSON(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) throw new Error("MODEL_OUTPUT_NOT_STRICT_JSON");
  return JSON.parse(trimmed);
}

export class ProactiveActionConnectorService {
  private readonly runtime: ActionConnectorRuntimeService;
  private readonly registry: ProactiveScenarioRegistry;
  private stopping = false;

  constructor(
    private readonly db: PrismaClient,
    private readonly bridge: DurableActionConnectorToolBridge,
    codexRunner: ActionConnectorCodexRunner
  ) {
    this.registry = new ProactiveScenarioRegistry(db);
    this.runtime = new ActionConnectorRuntimeService(
      db as unknown as IntegrationInstanceRepositoryDb,
      fetch,
      codexRunner,
      bridge
    );
  }

  async start(): Promise<void> {
    await this.registry.seedBuiltins();
    await this.db.proactiveAgentRun.updateMany({
      where: { status: { in: ["RUNNING", "WAITING_TOOL", "VALIDATING"] } },
      data: { status: "QUEUED", error: { code: "RUNTIME_RESTARTED", retryable: true }, runAttempt: { increment: 1 } }
    });
    const queued = await this.db.proactiveAgentRun.findMany({ where: { status: "QUEUED" }, orderBy: { queuedAt: "asc" }, take: 50 });
    for (const run of queued) this.schedule(run.id);
  }

  stop(): void { this.stopping = true; }

  async receiveEvent(connectorId: string, raw: unknown) {
    const event = connectorEventSchema.parse(raw);
    const existing = await this.db.connectorEventReceipt.findUnique({
      where: { connectorId_eventId: { connectorId, eventId: event.eventId } }
    });
    if (existing) {
      const runs = await this.db.proactiveAgentRun.findMany({ where: { sourceEventReceiptId: existing.id }, orderBy: { createdAt: "asc" } });
      return { accepted: true, replay: true, receiptId: existing.id, runIds: runs.map((run) => run.id), outcome: existing.outcome };
    }
    const connector = await this.db.integrationInstance.findUnique({ where: { id: connectorId } });
    if (!connector || connector.type !== "action_connector" || connector.status !== "active") throw new Error("CONNECTOR_NOT_ACTIVE");
    if (event.integrationPack.key !== XOMC_PACKAGE.key || event.integrationPack.version !== XOMC_PACKAGE.version ||
        event.integrationPack.digest !== XOMC_PACKAGE.digest) throw new Error("INTEGRATION_PACKAGE_NOT_INSTALLED");
    const decision = await this.registry.admit(connectorId, event);
    if (!decision.admitted.length) {
      const receipt = await this.createSuppressedReceipt(connectorId, event, decision.suppressed.length ? decision.suppressed.join(",") : "NO_ACTIVE_SCENARIO");
      return { accepted: true, replay: false, receiptId: receipt.id, outcome: receipt.outcome };
    }
    const created = await this.db.$transaction(async (tx) => {
      const receipt = await tx.connectorEventReceipt.create({
        data: this.receiptData(connectorId, event, {
          status: "queued",
          scenarios: decision.admitted.map((item) => item.spec.key),
          suppressed: decision.suppressed
        })
      });
      const runs = [];
      for (const admitted of decision.admitted) {
        runs.push(await tx.proactiveAgentRun.create({
          data: {
            connectorId,
            sourceEventReceiptId: receipt.id,
            scenarioKey: admitted.spec.key,
            scenarioVersion: admitted.spec.version,
            packageDigest: event.integrationPack.digest,
            handbookDigest: event.handbookDigest,
            resourceScope: event.resources as Prisma.InputJsonValue,
            scenarioSnapshot: admitted.spec as unknown as Prisma.InputJsonValue,
            rolloutMode: admitted.mode,
            rolloutPercentage: admitted.percentage,
            dedupeKey: admitted.dedupeKey,
            input: event as unknown as Prisma.InputJsonValue,
            traceId: event.traceId
          }
        }));
      }
      return { receipt, runs };
    });
    for (const run of created.runs) this.schedule(run.id);
    return { accepted: true, replay: false, receiptId: created.receipt.id, runIds: created.runs.map((run) => run.id), outcome: created.receipt.outcome };
  }

  async overview(connectorId: string) { return await this.registry.overview(connectorId); }

  async updateScenario(connectorId: string, scenarioKey: string, input: Parameters<ProactiveScenarioRegistry["updateScenario"]>[2]) {
    return await this.registry.updateScenario(connectorId, scenarioKey, input);
  }

  async heartbeat(connectorId: string, input: Parameters<ProactiveScenarioRegistry["heartbeat"]>[1]) {
    return await this.registry.heartbeat(connectorId, input);
  }

  async cancelRun(connectorId: string, runId: string) {
    const changed = await this.db.proactiveAgentRun.updateMany({
      where: { id: runId, connectorId, status: { in: ["QUEUED", "RUNNING", "WAITING_TOOL", "VALIDATING"] } },
      data: { status: "CANCELLED", completedAt: new Date(), error: { code: "CANCELLED_BY_ADMIN", retryable: false } }
    });
    if (changed.count !== 1) throw new Error("RUN_NOT_CANCELLABLE");
    this.bridge.disposeRun(connectorId, runId);
    return { ok: true };
  }

  private async createSuppressedReceipt(connectorId: string, event: ConnectorEventEnvelope, reason: string) {
    return await this.db.connectorEventReceipt.create({ data: this.receiptData(connectorId, event, { status: "suppressed", reason }) });
  }

  private receiptData(connectorId: string, event: ConnectorEventEnvelope, outcome: Record<string, unknown>) {
    return {
      connectorId, eventId: event.eventId, eventType: event.eventType, source: event.source,
      occurredAt: new Date(event.occurredAt), traceId: event.traceId,
      packageKey: event.integrationPack.key, packageVersion: event.integrationPack.version,
      packageDigest: event.integrationPack.digest, handbookDigest: event.handbookDigest,
      envelope: event as unknown as Prisma.InputJsonValue, outcome: outcome as Prisma.InputJsonValue
    };
  }

  private schedule(runId: string): void {
    if (this.stopping) return;
    setImmediate(() => { void this.execute(runId); });
  }

  private async execute(runId: string): Promise<void> {
    const claimed = await this.db.proactiveAgentRun.updateMany({
      where: { id: runId, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(), error: Prisma.JsonNull }
    });
    if (claimed.count !== 1) return;
    const run = await this.db.proactiveAgentRun.findUnique({ where: { id: runId } });
    if (!run) return;
    try {
      const spec = run.scenarioSnapshot as unknown as ScenarioSpec | null;
      if (!spec || spec.key !== run.scenarioKey || !spec.agent?.prompt) throw new Error("SCENARIO_SNAPSHOT_MISSING");
      const connector = await this.db.integrationInstance.findUnique({ where: { id: run.connectorId } });
      const configRow = await this.db.integrationInstanceConfig.findUnique({ where: { integrationInstanceId: run.connectorId } });
      if (!connector) throw new Error("CONNECTOR_NOT_FOUND");
      actionConnectorConfigSchema.parse(record(configRow?.config));
      this.bridge.prepareBackgroundRun({
        connectorId: run.connectorId, runId: run.id, scenarioKey: run.scenarioKey,
        packageDigest: run.packageDigest, handbookDigest: run.handbookDigest,
        resourceScope: run.resourceScope as unknown as ConnectorEventEnvelope["resources"], traceId: run.traceId,
        allowedOperations: spec.agent.allowedOperations,
        timeoutSeconds: spec.agent.timeoutSeconds
      });
      let finalText = "";
      let runtimeError: Error | undefined;
      const emit = (event: AgentStreamEvent) => {
        if (event.type === "delta") finalText += event.text;
        if (event.type === "error") runtimeError = new Error(`${event.error.code}: ${event.error.message}`);
      };
      const sourceEvent = connectorEventSchema.parse(run.input);
      const apiHandbook = record(sourceEvent.data).apiHandbook;
      const externalIdentityMetadata: Record<string, unknown> = { sourceSystem: "omc" };
      if (Object.keys(record(apiHandbook)).length > 0) externalIdentityMetadata.apiHandbook = apiHandbook;
      await this.runtime.streamChat({
        connectorId: run.connectorId,
        delegationHeaderValue: `Bearer proactive:${run.id}`,
        request: {
          message: `${spec.agent.prompt}\n\n触发事件：${JSON.stringify(sourceEvent)}`,
          clientRunId: run.id,
          conversationId: `proactive-${run.id}`,
          mode: "execute", locale: "zh-CN", timezone: "Asia/Shanghai", attachments: [],
          context: {
            proactive: true, scenarioKey: run.scenarioKey, sourceEvent,
            externalIdentity: {
              externalUserId: "xomc-proactive-service",
              metadata: externalIdentityMetadata
            }
          }
        }, emit
      });
      if (runtimeError) throw runtimeError;
      await this.db.proactiveAgentRun.update({ where: { id: run.id }, data: { status: "VALIDATING" } });
      const finding = findingSchema.parse(strictJSON(finalText));
      if (finding.scenarioKey !== run.scenarioKey) throw new Error("FINDING_SCENARIO_MISMATCH");
      if (finding.scenarioVersion !== spec.version) throw new Error("FINDING_SCENARIO_VERSION_MISMATCH");
      if (!resourcesWithinScope(finding.resourceRefs, run.resourceScope as unknown as ConnectorEventEnvelope["resources"])) {
        throw new Error("FINDING_RESOURCE_SCOPE_VIOLATION");
      }
      if (run.rolloutMode === "shadow") {
        await this.db.proactiveAgentRun.update({ where: { id: run.id }, data: {
          status: "COMPLETED", output: finding as unknown as Prisma.InputJsonValue, completedAt: new Date()
        } });
        return;
      }
      await this.db.$transaction(async (tx) => {
        const saved = await tx.proactiveAgentFinding.create({ data: {
          runId: run.id, connectorId: run.connectorId, scenarioKey: run.scenarioKey,
          scenarioVersion: finding.scenarioVersion, packageDigest: run.packageDigest,
          handbookDigest: run.handbookDigest, title: finding.title, summary: finding.summary,
          severity: finding.severity, confidence: finding.confidence,
          resourceRefs: finding.resourceRefs as Prisma.InputJsonValue, facts: finding.facts as Prisma.InputJsonValue,
          hypotheses: finding.hypotheses as Prisma.InputJsonValue, details: finding.details as Prisma.InputJsonValue,
          suggestedActions: finding.suggestedActions as Prisma.InputJsonValue,
          presentation: finding.presentation as Prisma.InputJsonValue,
          expiresAt: finding.expiresAt ? new Date(finding.expiresAt) : new Date(Date.now() + spec.delivery.expiresAfterSeconds * 1_000)
        } });
        await tx.proactiveFindingDelivery.create({ data: { findingId: saved.id, connectorId: run.connectorId } });
        await tx.proactiveAgentRun.update({ where: { id: run.id }, data: {
          status: "COMPLETED", output: finding as unknown as Prisma.InputJsonValue, completedAt: new Date()
        } });
      });
    } catch (error) {
      await this.db.proactiveAgentRun.update({ where: { id: run.id }, data: {
        status: "FAILED", completedAt: new Date(), error: {
          code: "BACKGROUND_RUN_FAILED", message: error instanceof Error ? error.message : "Background run failed", retryable: false
        }
      } });
    } finally {
      this.bridge.disposeRun(run.connectorId, run.id);
    }
  }
}
