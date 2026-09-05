import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionConnectorRuntimeService, type ActionConnectorCodexRunner, type AgentStreamEvent } from "../runtime.js";
import type { IntegrationInstanceRepositoryDb } from "../../../persistence/integration-instance-repository.js";
import { connectorEventSchema, findingSchema, XOMC_PACKAGE, type ConnectorEventEnvelope } from "./contracts.js";
import { DurableActionConnectorToolBridge } from "./durable-tool-bridge.js";
import { resourcesWithinScope, type ScenarioSpec } from "./scenario-catalog.js";
import { ProactiveScenarioRegistry } from "./scenario-registry.js";
import { AssistantPlanner } from "../assistants/planner.js";
import { executionRequestSchema, parseModelJSON } from "../assistants/contracts.js";
import { ASSISTANT_SNAPSHOT_KIND, assistantRequest, executeAssistant } from "../assistants/engine.js";

const activeStatuses = ["RUNNING", "WAITING_TOOL", "VALIDATING"] as const;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export class ProactiveActionConnectorService {
  private readonly runtime: ActionConnectorRuntimeService;
  private readonly registry: ProactiveScenarioRegistry;
  private readonly planner: AssistantPlanner;
  private readonly workerId = randomUUID();
  private readonly active = new Map<string, AbortController>();
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private pumping = false;

  constructor(private readonly db: PrismaClient, private readonly bridge: DurableActionConnectorToolBridge, runner: ActionConnectorCodexRunner) {
    this.registry = new ProactiveScenarioRegistry(db);
    this.runtime = new ActionConnectorRuntimeService(db as unknown as IntegrationInstanceRepositoryDb, fetch, runner, bridge);
    this.planner = new AssistantPlanner(db as unknown as IntegrationInstanceRepositoryDb, runner);
  }

  async start(): Promise<void> {
    await this.registry.seedBuiltins();
    this.stopping = false;
    await this.pump();
    this.timer = setInterval(() => { void this.pump().catch((error) => console.error("proactive worker poll failed", error)); }, 1_000);
    this.timer.unref();
  }
  stop(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.active.values()) controller.abort(new Error("WORKER_STOPPING"));
  }

  async planAssistant(connectorId: string, input: unknown, signal?: AbortSignal) { return this.planner.plan(connectorId, input, signal); }

  async submitAssistantRun(connectorId: string, raw: unknown) {
    const request = executionRequestSchema.parse(raw);
    const connector = await this.db.integrationInstance.findUnique({ where: { id: connectorId } });
    if (!connector || connector.type !== "action_connector" || connector.status !== "active") throw new Error("CONNECTOR_NOT_ACTIVE");
    const fingerprint = createHash("sha256").update(canonical(request)).digest("hex");
    const replay = async () => {
      const existing = await this.db.proactiveAgentRun.findUnique({ where: { id: request.runId } });
      if (!existing) return undefined;
      const snapshot = record(existing.scenarioSnapshot);
      if (existing.connectorId !== connectorId || snapshot.kind !== ASSISTANT_SNAPSHOT_KIND || snapshot.fingerprint !== fingerprint) throw new Error("ASSISTANT_RUN_CONFLICT");
      return this.assistantRun(connectorId, existing.id);
    };
    const previous = await replay();
    if (previous) return previous;
    const pending = await this.db.proactiveAgentRun.count({ where: { connectorId, status: { in: ["QUEUED", ...activeStatuses] } } });
    if (pending >= 100) throw new Error("ASSISTANT_QUEUE_FULL");
    try {
      await this.db.proactiveAgentRun.create({ data: {
        id: request.runId, connectorId, scenarioKey: `assistant:${request.assistantId}`,
        scenarioVersion: request.revision, packageDigest: request.definitionDigest, handbookDigest: request.handbookDigest,
        resourceScope: [], scenarioSnapshot: { kind: ASSISTANT_SNAPSHOT_KIND, fingerprint, request } as unknown as Prisma.InputJsonValue,
        input: request as unknown as Prisma.InputJsonValue, rolloutMode: "active", rolloutPercentage: 100, traceId: request.runId,
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const raced = await replay();
      if (raced) return raced;
      throw error;
    }
    return this.assistantRun(connectorId, request.runId);
  }

  async assistantRun(connectorId: string, runId: string) {
    const run = await this.db.proactiveAgentRun.findFirst({ where: { id: runId, connectorId } });
    if (!run || record(run.scenarioSnapshot).kind !== ASSISTANT_SNAPSHOT_KIND) throw new Error("ASSISTANT_RUN_NOT_FOUND");
    const tools = await this.db.connectorToolInvocation.findMany({
      where: { runId }, orderBy: { createdAt: "asc" }, take: 100,
      select: { id: true, operationId: true, status: true, createdAt: true },
    });
    return { id: run.id, status: run.status, output: run.output, error: run.error, startedAt: run.startedAt, completedAt: run.completedAt, tools };
  }

  async receiveEvent(connectorId: string, raw: unknown) {
    const event = connectorEventSchema.parse(raw);
    const existing = await this.db.connectorEventReceipt.findUnique({ where: { connectorId_eventId: { connectorId, eventId: event.eventId } } });
    if (existing) {
      const runs = await this.db.proactiveAgentRun.findMany({ where: { sourceEventReceiptId: existing.id }, orderBy: { createdAt: "asc" } });
      return { accepted: true, replay: true, receiptId: existing.id, runIds: runs.map((run) => run.id), outcome: existing.outcome };
    }
    const connector = await this.db.integrationInstance.findUnique({ where: { id: connectorId } });
    if (!connector || connector.type !== "action_connector" || connector.status !== "active") throw new Error("CONNECTOR_NOT_ACTIVE");
    // Compatibility path for installed v1 scenarios. User-created assistants do
    // not pass through this package or scenario catalog.
    if (event.integrationPack.key !== XOMC_PACKAGE.key || event.integrationPack.version !== XOMC_PACKAGE.version || event.integrationPack.digest !== XOMC_PACKAGE.digest) throw new Error("INTEGRATION_PACKAGE_NOT_INSTALLED");
    const decision = await this.registry.admit(connectorId, event);
    if (!decision.admitted.length) {
      const receipt = await this.db.connectorEventReceipt.create({ data: this.receiptData(connectorId, event, { status: "suppressed", reason: decision.suppressed.join(",") || "NO_ACTIVE_SCENARIO" }) });
      return { accepted: true, replay: false, receiptId: receipt.id, outcome: receipt.outcome };
    }
    const created = await this.db.$transaction(async (tx) => {
      const receipt = await tx.connectorEventReceipt.create({ data: this.receiptData(connectorId, event, {
        status: "queued", scenarios: decision.admitted.map((item) => item.spec.key), suppressed: decision.suppressed,
      }) });
      const runs = [];
      for (const admitted of decision.admitted) runs.push(await tx.proactiveAgentRun.create({ data: {
        connectorId, sourceEventReceiptId: receipt.id, scenarioKey: admitted.spec.key, scenarioVersion: admitted.spec.version,
        packageDigest: event.integrationPack.digest, handbookDigest: event.handbookDigest,
        resourceScope: event.resources as Prisma.InputJsonValue, scenarioSnapshot: admitted.spec as unknown as Prisma.InputJsonValue,
        rolloutMode: admitted.mode, rolloutPercentage: admitted.percentage, dedupeKey: admitted.dedupeKey,
        input: event as unknown as Prisma.InputJsonValue, traceId: event.traceId,
      } }));
      return { receipt, runs };
    });
    return { accepted: true, replay: false, receiptId: created.receipt.id, runIds: created.runs.map((run) => run.id), outcome: created.receipt.outcome };
  }

  async overview(connectorId: string) { return this.registry.overview(connectorId); }
  async updateScenario(connectorId: string, key: string, input: Parameters<ProactiveScenarioRegistry["updateScenario"]>[2]) { return this.registry.updateScenario(connectorId, key, input); }
  async heartbeat(connectorId: string, input: Parameters<ProactiveScenarioRegistry["heartbeat"]>[1]) { return this.registry.heartbeat(connectorId, input); }
  async cancelRun(connectorId: string, runId: string) {
    const changed = await this.db.proactiveAgentRun.updateMany({
      where: { id: runId, connectorId, status: { in: ["QUEUED", ...activeStatuses] } },
      data: { status: "CANCELLED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, error: { code: "CANCELLED_BY_USER", retryable: false } },
    });
    if (!changed.count) {
      const run = await this.db.proactiveAgentRun.findFirst({ where: { id: runId, connectorId } });
      if (!run) throw new Error("RUN_NOT_FOUND");
      return { ok: true, status: run.status };
    }
    await this.db.connectorToolInvocation.updateMany({ where: { runId, connectorId, status: { in: ["PENDING", "LEASED"] } }, data: { status: "EXPIRED" } });
    this.active.get(runId)?.abort(new Error("CANCELLED_BY_USER"));
    this.bridge.disposeRun(connectorId, runId);
    return { ok: true, status: "CANCELLED" };
  }

  private receiptData(connectorId: string, event: ConnectorEventEnvelope, outcome: Record<string, unknown>) {
    return {
      connectorId, eventId: event.eventId, eventType: event.eventType, source: event.source, occurredAt: new Date(event.occurredAt), traceId: event.traceId,
      packageKey: event.integrationPack.key, packageVersion: event.integrationPack.version, packageDigest: event.integrationPack.digest, handbookDigest: event.handbookDigest,
      envelope: event as unknown as Prisma.InputJsonValue, outcome: outcome as Prisma.InputJsonValue,
    };
  }

  private async pump(): Promise<void> {
    if (this.stopping || this.pumping) return;
    this.pumping = true;
    try {
      const now = new Date();
      const stale = await this.db.proactiveAgentRun.findMany({ where: {
        status: { in: [...activeStatuses] }, OR: [{ leaseExpiresAt: { lte: now } }, { leaseExpiresAt: null }],
      }, take: 100 });
      for (const run of stale) {
        const changed = await this.db.proactiveAgentRun.updateMany({ where: {
          id: run.id, runAttempt: run.runAttempt, status: { in: [...activeStatuses] }, OR: [{ leaseExpiresAt: { lte: now } }, { leaseExpiresAt: null }],
        }, data: { status: run.runAttempt >= 3 ? "FAILED" : "QUEUED", leaseOwner: null, leaseExpiresAt: null,
          ...(run.runAttempt >= 3 ? { completedAt: now } : {}), error: { code: "EXECUTION_LEASE_EXPIRED", retryable: run.runAttempt < 3 } } });
        if (changed.count) await this.db.connectorToolInvocation.updateMany({ where: { runId: run.id, runAttempt: run.runAttempt, status: { in: ["PENDING", "LEASED"] } }, data: { status: "EXPIRED" } });
      }
      const slots = Math.max(0, 4 - this.active.size);
      if (!slots) return;
      const queued = await this.db.proactiveAgentRun.findMany({ where: { status: "QUEUED", id: { notIn: [...this.active.keys()] } }, orderBy: { queuedAt: "asc" }, take: slots });
      for (const candidate of queued) {
        if (this.stopping) break;
        const claimed = await this.db.proactiveAgentRun.updateMany({ where: { id: candidate.id, status: "QUEUED" }, data: {
          status: "RUNNING", startedAt: now, leaseOwner: this.workerId, leaseExpiresAt: new Date(Date.now() + 30_000), runAttempt: { increment: 1 }, error: Prisma.JsonNull,
        } });
        if (!claimed.count) continue;
        const controller = new AbortController();
        this.active.set(candidate.id, controller);
        void this.execute(candidate.id, controller).catch((error) => {
          if (this.active.get(candidate.id) === controller) this.active.delete(candidate.id);
          console.error("proactive execution failed", error);
        });
      }
    } finally { this.pumping = false; }
  }

  private async execute(runId: string, controller: AbortController): Promise<void> {
    const run = await this.db.proactiveAgentRun.findUnique({ where: { id: runId } });
    if (!run) { this.active.delete(runId); return; }
    const guard = { id: run.id, leaseOwner: this.workerId, runAttempt: run.runAttempt, status: { in: [...activeStatuses] } };
    const renewal = setInterval(() => { void this.db.proactiveAgentRun.updateMany({ where: guard, data: { leaseExpiresAt: new Date(Date.now() + 30_000) } })
      .then((value) => { if (!value.count) controller.abort(new Error("EXECUTION_LEASE_LOST")); })
      .catch(() => controller.abort(new Error("EXECUTION_LEASE_RENEWAL_FAILED"))); }, 10_000);
    renewal.unref();
    try {
      const request = assistantRequest(run.scenarioSnapshot);
      if (request) {
        const output = await executeAssistant({ db: this.db, runtime: this.runtime, bridge: this.bridge, run, request, signal: controller.signal });
        await this.db.proactiveAgentRun.updateMany({ where: guard, data: { status: "COMPLETED", output: output as unknown as Prisma.InputJsonValue, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
        return;
      }
      const spec = run.scenarioSnapshot as unknown as ScenarioSpec | null;
      if (!spec || spec.key !== run.scenarioKey || !spec.agent?.prompt) throw new Error("SCENARIO_SNAPSHOT_MISSING");
      this.bridge.prepareBackgroundRun({
        connectorId: run.connectorId, runId: run.id, scenarioKey: run.scenarioKey, packageDigest: run.packageDigest, handbookDigest: run.handbookDigest,
        resourceScope: run.resourceScope as unknown as ConnectorEventEnvelope["resources"], traceId: run.traceId,
        allowedOperations: spec.agent.allowedOperations, timeoutSeconds: spec.agent.timeoutSeconds,
        maxToolCalls: spec.agent.maxToolCalls, runAttempt: run.runAttempt, signal: controller.signal,
      });
      let text = "";
      let runtimeError: Error | undefined;
      const emit = (event: AgentStreamEvent) => {
        if (event.type === "delta" && !runtimeError) {
          if (Buffer.byteLength(text) + Buffer.byteLength(event.text) > spec.agent.maxOutputBytes) {
            runtimeError = new Error("OUTPUT_BUDGET_EXCEEDED"); controller.abort(runtimeError);
          } else text += event.text;
        }
        if (event.type === "error") runtimeError = new Error(event.error.code);
      };
      const sourceEvent = connectorEventSchema.parse(run.input);
      await this.runtime.streamChat({
        connectorId: run.connectorId, delegationHeaderValue: `Bearer proactive:${run.id}`,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(spec.agent.timeoutSeconds * 1000)]),
        request: {
          message: `${spec.agent.prompt}\n\n触发事件：${JSON.stringify(sourceEvent)}`, clientRunId: run.id,
          conversationId: `proactive-${run.id}-${run.runAttempt}`, mode: "execute", locale: "zh-CN", timezone: "Asia/Shanghai", attachments: [],
          context: { proactive: true, scenarioKey: run.scenarioKey, sourceEvent, externalIdentity: {
            externalUserId: "xomc-proactive-service", metadata: { sourceSystem: "omc", apiHandbook: record(sourceEvent.data).apiHandbook },
          } },
        }, emit,
      });
      controller.signal.throwIfAborted();
      if (runtimeError) throw runtimeError;
      const validating = await this.db.proactiveAgentRun.updateMany({ where: guard, data: { status: "VALIDATING" } });
      if (!validating.count) return;
      const finding = findingSchema.parse(parseModelJSON(text));
      if (finding.scenarioKey !== run.scenarioKey || finding.scenarioVersion !== spec.version) throw new Error("FINDING_SCENARIO_MISMATCH");
      if (!resourcesWithinScope(finding.resourceRefs, run.resourceScope as unknown as ConnectorEventEnvelope["resources"])) throw new Error("FINDING_RESOURCE_SCOPE_VIOLATION");
      await this.db.$transaction(async (tx) => {
        const finished = await tx.proactiveAgentRun.updateMany({ where: guard, data: { status: "COMPLETED", output: finding as unknown as Prisma.InputJsonValue, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
        if (!finished.count || run.rolloutMode === "shadow") return;
        const saved = await tx.proactiveAgentFinding.create({ data: {
          runId: run.id, connectorId: run.connectorId, scenarioKey: run.scenarioKey, scenarioVersion: finding.scenarioVersion,
          packageDigest: run.packageDigest, handbookDigest: run.handbookDigest, title: finding.title, summary: finding.summary,
          severity: finding.severity, confidence: finding.confidence, resourceRefs: finding.resourceRefs as Prisma.InputJsonValue,
          facts: finding.facts as Prisma.InputJsonValue, hypotheses: finding.hypotheses as Prisma.InputJsonValue, details: finding.details as Prisma.InputJsonValue,
          suggestedActions: finding.suggestedActions as Prisma.InputJsonValue, presentation: finding.presentation as Prisma.InputJsonValue,
          expiresAt: finding.expiresAt ? new Date(finding.expiresAt) : new Date(Date.now() + spec.delivery.expiresAfterSeconds * 1000),
        } });
        await tx.proactiveFindingDelivery.create({ data: { findingId: saved.id, connectorId: run.connectorId } });
      });
    } catch (error) {
      if (!this.stopping) await this.db.proactiveAgentRun.updateMany({ where: guard, data: {
        status: "FAILED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null,
        error: { code: "BACKGROUND_RUN_FAILED", message: (error instanceof Error ? error.message : "Background run failed").slice(0, 2000), retryable: false },
      } });
    } finally {
      clearInterval(renewal);
      this.bridge.disposeRun(run.connectorId, run.id);
      if (this.active.get(run.id) === controller) this.active.delete(run.id);
    }
  }
}
