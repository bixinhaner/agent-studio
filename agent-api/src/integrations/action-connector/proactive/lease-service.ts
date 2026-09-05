import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

function bounded(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

export class ProactiveLeaseService {
  constructor(private readonly db: PrismaClient) {}

  async leaseTools(connectorId: string, workerId: string, maxItems: number, leaseSeconds: number) {
    const limit = bounded(maxItems, 8, 50);
    const seconds = bounded(leaseSeconds, 60, 300);
    return await this.db.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM connector_tool_invocations
        WHERE connector_id = ${connectorId}
          AND (status = 'PENDING' OR (status = 'LEASED' AND lease_expires_at <= now()))
          AND deadline_at > now()
          AND EXISTS (
            SELECT 1 FROM proactive_agent_runs r
            WHERE r.id = connector_tool_invocations.run_id
              AND r.connector_id = connector_tool_invocations.connector_id
              AND r.run_attempt = connector_tool_invocations.run_attempt
              AND r.status IN ('RUNNING', 'WAITING_TOOL')
              AND r.lease_expires_at > now()
          )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `);
      const items = [];
      for (const candidate of candidates) {
        const token = randomBytes(32).toString("base64url");
        const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
          UPDATE connector_tool_invocations
          SET status = 'LEASED', lease_owner = ${workerId}, lease_token_hash = ${tokenHash(token)},
              lease_expires_at = now() + (${seconds} * interval '1 second'), attempt = attempt + 1,
              updated_at = now()
          WHERE id = ${candidate.id}
          RETURNING *
        `);
        const row = rows[0];
        if (!row) continue;
        items.push({
          contractVersion: "1.0", invocationId: row.id, runId: row.run_id, scenarioKey: row.scenario_key,
          packageDigest: row.package_digest, handbookDigest: row.handbook_digest,
          operationId: row.operation_id, method: row.method, path: row.path, arguments: row.arguments,
          resourceScope: row.resource_scope, leaseToken: token,
          leaseExpiresAt: row.lease_expires_at, deadlineAt: row.deadline_at, traceId: row.trace_id
        });
      }
      return items;
    });
  }

  async submitToolResult(connectorId: string, invocationId: string, input: Record<string, unknown>) {
    const leaseToken = typeof input.leaseToken === "string" ? input.leaseToken : "";
    if (input.status !== "succeeded" && input.status !== "failed") throw new Error("TOOL_RESULT_STATUS_INVALID");
    return await this.db.$transaction(async (tx) => {
      // Lock both records before validating the fencing token. A concurrent run
      // cancellation/reclaim cannot turn a stale response into current evidence.
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT i.id FROM connector_tool_invocations i
        JOIN proactive_agent_runs r ON r.id = i.run_id AND r.connector_id = i.connector_id
        WHERE i.id = ${invocationId} AND i.connector_id = ${connectorId}
        FOR UPDATE OF r, i
      `);
      if (!rows.length) throw new Error("TOOL_INVOCATION_NOT_FOUND");
      const invocation = await tx.connectorToolInvocation.findUnique({ where: { id: invocationId } });
      if (!invocation) throw new Error("TOOL_INVOCATION_NOT_FOUND");
      if (invocation.status === "SUCCEEDED" || invocation.status === "FAILED") {
        if (JSON.stringify(invocation.result ?? invocation.error) === JSON.stringify(input)) return invocation;
        throw new Error("TOOL_RESULT_CONFLICT");
      }
      const run = await tx.proactiveAgentRun.findUnique({ where: { id: invocation.runId } });
      if (!run || !["RUNNING", "WAITING_TOOL"].includes(run.status) ||
          run.runAttempt !== invocation.runAttempt || !run.leaseExpiresAt || run.leaseExpiresAt <= new Date()) {
        throw new Error("BACKGROUND_RUN_NOT_ACTIVE");
      }
      if (invocation.status !== "LEASED" || !invocation.leaseExpiresAt || invocation.leaseExpiresAt <= new Date() ||
          invocation.deadlineAt <= new Date() || invocation.leaseTokenHash !== tokenHash(leaseToken)) throw new Error("TOOL_LEASE_INVALID");
      const succeeded = input.status === "succeeded";
      return await tx.connectorToolInvocation.update({
        where: { id: invocationId },
        data: {
          status: succeeded ? "SUCCEEDED" : "FAILED",
          result: succeeded ? input as Prisma.InputJsonValue : Prisma.JsonNull,
          error: succeeded ? Prisma.JsonNull : input as Prisma.InputJsonValue,
          leaseTokenHash: null, leaseOwner: null, leaseExpiresAt: null,
        },
      });
    });
  }

  async leaseFindings(connectorId: string, workerId: string, maxItems: number, leaseSeconds: number) {
    const limit = bounded(maxItems, 8, 50);
    const seconds = bounded(leaseSeconds, 60, 300);
    return await this.db.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM proactive_finding_deliveries
        WHERE connector_id = ${connectorId}
          AND (status = 'PENDING' OR (status = 'LEASED' AND lease_expires_at <= now()))
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `);
      const items = [];
      for (const candidate of candidates) {
        const token = randomBytes(32).toString("base64url");
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE proactive_finding_deliveries
          SET status = 'LEASED', lease_owner = ${workerId}, lease_token_hash = ${tokenHash(token)},
              lease_expires_at = now() + (${seconds} * interval '1 second'), attempt = attempt + 1,
              updated_at = now()
          WHERE id = ${candidate.id}
          RETURNING id
        `);
        if (!rows[0]) continue;
        const delivery = await tx.proactiveFindingDelivery.findUnique({
          where: { id: candidate.id }, include: { finding: true }
        });
        if (!delivery) continue;
        items.push({
          contractVersion: "1.0", deliveryId: delivery.id, findingId: delivery.finding.id,
          runId: delivery.finding.runId, scenarioKey: delivery.finding.scenarioKey,
          packageDigest: delivery.finding.packageDigest, handbookDigest: delivery.finding.handbookDigest,
          finding: {
            schemaVersion: "1.0", scenarioKey: delivery.finding.scenarioKey,
            scenarioVersion: delivery.finding.scenarioVersion, title: delivery.finding.title,
            summary: delivery.finding.summary, severity: delivery.finding.severity,
            confidence: delivery.finding.confidence, resourceRefs: delivery.finding.resourceRefs,
            facts: delivery.finding.facts, hypotheses: delivery.finding.hypotheses, details: delivery.finding.details,
            suggestedActions: delivery.finding.suggestedActions, presentation: delivery.finding.presentation,
            expiresAt: delivery.finding.expiresAt?.toISOString()
          },
          leaseToken: token, leaseExpiresAt: delivery.leaseExpiresAt, traceId: delivery.finding.runId
        });
      }
      return items;
    });
  }

  async acknowledgeFinding(connectorId: string, deliveryId: string, input: Record<string, unknown>) {
    const leaseToken = typeof input.leaseToken === "string" ? input.leaseToken : "";
    return await this.db.$transaction(async (tx) => {
      const delivery = await tx.proactiveFindingDelivery.findUnique({ where: { id: deliveryId } });
      if (!delivery || delivery.connectorId !== connectorId) throw new Error("FINDING_DELIVERY_NOT_FOUND");
      if (["DELIVERED", "REJECTED", "FAILED"].includes(delivery.status)) {
        if (delivery.localFindingId === input.localFindingId || delivery.status === String(input.status).toUpperCase()) return delivery;
        throw new Error("FINDING_ACK_CONFLICT");
      }
      if (delivery.status !== "LEASED" || !delivery.leaseExpiresAt || delivery.leaseExpiresAt <= new Date() ||
          delivery.leaseTokenHash !== tokenHash(leaseToken)) throw new Error("FINDING_LEASE_INVALID");
      const status = input.status === "delivered" ? "DELIVERED" : "REJECTED";
      return await tx.proactiveFindingDelivery.update({
        where: { id: deliveryId },
        data: { status, localFindingId: typeof input.localFindingId === "string" ? input.localFindingId : null,
          error: input.error ? input.error as Prisma.InputJsonValue : Prisma.JsonNull,
          leaseTokenHash: null, leaseOwner: null, leaseExpiresAt: null }
      });
    });
  }
}
