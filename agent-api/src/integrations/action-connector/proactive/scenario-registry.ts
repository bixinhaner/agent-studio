import { Prisma, type PrismaClient } from "@prisma/client";

import { XOMC_PACKAGE, type ConnectorEventEnvelope } from "./contracts.js";
import {
  BUILTIN_SCENARIOS,
  includedInRollout,
  matchesScenario,
  renderDedupeKey,
  type ScenarioMode,
  type ScenarioSpec
} from "./scenario-catalog.js";

type AdmittedScenario = {
  scenarioId: string;
  spec: ScenarioSpec;
  mode: ScenarioMode;
  percentage: number;
  dedupeKey: string;
};

const toDbMode = (mode: ScenarioMode) => mode.toUpperCase() as "DISABLED" | "SHADOW" | "ACTIVE";
const fromDbMode = (mode: string): ScenarioMode => mode.toLowerCase() as ScenarioMode;

function asSpec(value: Prisma.JsonValue): ScenarioSpec {
  return value as unknown as ScenarioSpec;
}

export class ProactiveScenarioRegistry {
  constructor(private readonly db: PrismaClient) {}

  async seedBuiltins(): Promise<void> {
    const now = new Date();
    const pkg = await this.db.proactiveIntegrationPackage.upsert({
      where: { digest: XOMC_PACKAGE.digest },
      create: {
        packageKey: XOMC_PACKAGE.key,
        version: XOMC_PACKAGE.version,
        digest: XOMC_PACKAGE.digest,
        manifest: {
          apiVersion: "agentstudio.integration-pack/v1",
          kind: "IntegrationPackage",
          metadata: { key: XOMC_PACKAGE.key, version: XOMC_PACKAGE.version, owner: "xOMC Team" },
          scenarios: BUILTIN_SCENARIOS.map((scenario) => scenario.key)
        },
        status: "ACTIVE",
        validatedAt: now,
        activatedAt: now
      },
      update: { status: "ACTIVE", validatedAt: now, activatedAt: now }
    });

    for (const spec of BUILTIN_SCENARIOS) {
      await this.db.proactiveAgentScenario.upsert({
        where: { packageId_scenarioKey: { packageId: pkg.id, scenarioKey: spec.key } },
        create: {
          packageId: pkg.id,
          scenarioKey: spec.key,
          version: spec.version,
          name: spec.name,
          description: spec.description,
          eventType: spec.eventType,
          compiledSpec: spec as unknown as Prisma.InputJsonValue,
          defaultMode: toDbMode(spec.rollout.mode),
          defaultPercentage: spec.rollout.percentage
        },
        update: {
          version: spec.version,
          name: spec.name,
          description: spec.description,
          eventType: spec.eventType,
          compiledSpec: spec as unknown as Prisma.InputJsonValue,
          defaultMode: toDbMode(spec.rollout.mode),
          defaultPercentage: spec.rollout.percentage
        }
      });
    }
  }

  async ensureConnectorSettings(connectorId: string): Promise<void> {
    const scenarios = await this.db.proactiveAgentScenario.findMany({
      where: { package: { digest: XOMC_PACKAGE.digest, status: "ACTIVE" } }
    });
    for (const scenario of scenarios) {
      const spec = asSpec(scenario.compiledSpec);
      await this.db.proactiveConnectorScenarioSetting.upsert({
        where: { connectorId_scenarioId: { connectorId, scenarioId: scenario.id } },
        create: {
          connectorId,
          scenarioId: scenario.id,
          rolloutMode: scenario.defaultMode,
          rolloutPercentage: scenario.defaultPercentage,
          maxConcurrentRuns: spec.limits.maxConcurrentRuns,
          maxRunsPerHour: spec.limits.maxRunsPerHour
        },
        update: {}
      });
    }
  }

  async admit(connectorId: string, event: ConnectorEventEnvelope): Promise<{ admitted: AdmittedScenario[]; suppressed: string[] }> {
    await this.ensureConnectorSettings(connectorId);
    const settings = await this.db.proactiveConnectorScenarioSetting.findMany({
      where: {
        connectorId,
        scenario: { package: { digest: event.integrationPack.digest, status: "ACTIVE" }, eventType: event.eventType }
      },
      include: { scenario: true }
    });
    const admitted: AdmittedScenario[] = [];
    const suppressed: string[] = [];
    for (const setting of settings) {
      const spec = asSpec(setting.scenario.compiledSpec);
      const mode = fromDbMode(setting.rolloutMode);
      if (mode === "disabled") {
        suppressed.push(`${spec.key}:disabled`);
        continue;
      }
      if (!matchesScenario(spec, event)) {
        suppressed.push(`${spec.key}:filtered`);
        continue;
      }
      const dedupeKey = renderDedupeKey(spec, event);
      if (!includedInRollout(connectorId, spec, setting.rolloutPercentage, dedupeKey)) {
        suppressed.push(`${spec.key}:rollout`);
        continue;
      }
      const running = await this.db.proactiveAgentRun.count({
        where: { connectorId, scenarioKey: spec.key, status: { in: ["QUEUED", "RUNNING", "WAITING_TOOL", "VALIDATING"] } }
      });
      const hourly = await this.db.proactiveAgentRun.count({
        where: { connectorId, scenarioKey: spec.key, createdAt: { gte: new Date(Date.now() - 3_600_000) } }
      });
      if (running >= setting.maxConcurrentRuns || hourly >= setting.maxRunsPerHour) {
        suppressed.push(`${spec.key}:rate_limited`);
        continue;
      }
      const acquired = await this.acquireDedupe(connectorId, spec, dedupeKey, event.eventId);
      if (!acquired) {
        suppressed.push(`${spec.key}:cooldown`);
        continue;
      }
      admitted.push({ scenarioId: setting.scenarioId, spec, mode, percentage: setting.rolloutPercentage, dedupeKey });
    }
    return { admitted, suppressed };
  }

  private async acquireDedupe(connectorId: string, spec: ScenarioSpec, dedupeKey: string, eventId: string): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ connector_id: string }>>(Prisma.sql`
      INSERT INTO proactive_scenario_dedupe_locks
        (connector_id, scenario_key, dedupe_key, expires_at, run_id, created_at)
      VALUES
        (${connectorId}, ${spec.key}, ${dedupeKey}, now() + (${spec.dedupe.cooldownSeconds} * interval '1 second'), ${eventId}, now())
      ON CONFLICT (connector_id, scenario_key, dedupe_key)
      DO UPDATE SET expires_at = EXCLUDED.expires_at, run_id = EXCLUDED.run_id, created_at = now()
      WHERE proactive_scenario_dedupe_locks.expires_at <= now()
      RETURNING connector_id
    `);
    return rows.length === 1;
  }

  async updateScenario(connectorId: string, scenarioKey: string, input: {
    rolloutMode?: ScenarioMode;
    rolloutPercentage?: number;
    maxConcurrentRuns?: number;
    maxRunsPerHour?: number;
  }) {
    await this.ensureConnectorSettings(connectorId);
    if (input.rolloutMode && !["disabled", "shadow", "active"].includes(input.rolloutMode)) throw new Error("INVALID_ROLLOUT_MODE");
    const setting = await this.db.proactiveConnectorScenarioSetting.findFirst({
      where: { connectorId, scenario: { scenarioKey, package: { status: "ACTIVE" } } },
      include: { scenario: true }
    });
    if (!setting) throw new Error("SCENARIO_NOT_FOUND");
    const percentage = input.rolloutPercentage ?? setting.rolloutPercentage;
    if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new Error("INVALID_ROLLOUT_PERCENTAGE");
    if (input.rolloutMode === "active" && percentage === 0) throw new Error("ACTIVE_SCENARIO_REQUIRES_NON_ZERO_ROLLOUT");
    const maxConcurrentRuns = input.maxConcurrentRuns ?? setting.maxConcurrentRuns;
    const maxRunsPerHour = input.maxRunsPerHour ?? setting.maxRunsPerHour;
    if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 1_000) throw new Error("INVALID_CONCURRENCY_LIMIT");
    if (!Number.isInteger(maxRunsPerHour) || maxRunsPerHour < 1 || maxRunsPerHour > 100_000) throw new Error("INVALID_HOURLY_LIMIT");
    return await this.db.proactiveConnectorScenarioSetting.update({
      where: { id: setting.id },
      data: {
        rolloutMode: input.rolloutMode ? toDbMode(input.rolloutMode) : setting.rolloutMode,
        rolloutPercentage: percentage,
        maxConcurrentRuns,
        maxRunsPerHour
      },
      include: { scenario: true }
    });
  }

  async heartbeat(connectorId: string, input: {
    workerId: string;
    handbookDigest: string;
    queueDepth?: number;
    details?: Record<string, unknown>;
  }) {
    const now = new Date();
    return await this.db.proactiveConnectorHeartbeat.upsert({
      where: { connectorId },
      create: {
        connectorId,
        workerId: input.workerId,
        handbookDigest: input.handbookDigest,
        queueDepth: Math.max(0, Math.floor(input.queueDepth ?? 0)),
        details: (input.details ?? {}) as Prisma.InputJsonValue,
        lastSeenAt: now
      },
      update: {
        workerId: input.workerId,
        handbookDigest: input.handbookDigest,
        queueDepth: Math.max(0, Math.floor(input.queueDepth ?? 0)),
        details: (input.details ?? {}) as Prisma.InputJsonValue,
        lastSeenAt: now
      }
    });
  }

  async overview(connectorId: string) {
    await this.ensureConnectorSettings(connectorId);
    const since = new Date(Date.now() - 86_400_000);
    const [settings, packages, recentRuns, heartbeat] = await Promise.all([
      this.db.proactiveConnectorScenarioSetting.findMany({
        where: { connectorId },
        include: { scenario: { include: { package: true } } },
        orderBy: { scenario: { name: "asc" } }
      }),
      this.db.proactiveIntegrationPackage.findMany({ orderBy: { createdAt: "desc" } }),
      this.db.proactiveAgentRun.findMany({
        where: { connectorId, NOT: { scenarioKey: { startsWith: "assistant:" } } },
        orderBy: { createdAt: "desc" },
        take: 100
      }),
      this.db.proactiveConnectorHeartbeat.findUnique({ where: { connectorId } })
    ]);
    const scenarios = settings.map((setting) => {
	  const spec = setting.scenario.compiledSpec as unknown as ScenarioSpec;
      const runs = recentRuns.filter((run) => run.scenarioKey === setting.scenario.scenarioKey && run.createdAt >= since);
      const completed = runs.filter((run) => run.status === "COMPLETED").length;
      const durations = runs.flatMap((run) => run.startedAt && run.completedAt ? [run.completedAt.getTime() - run.startedAt.getTime()] : []);
      return {
        key: setting.scenario.scenarioKey,
        version: setting.scenario.version,
        name: setting.scenario.name,
        description: setting.scenario.description,
		status: fromDbMode(setting.rolloutMode) === "disabled" ? "DISABLED" : "ACTIVE",
		rolloutMode: fromDbMode(setting.rolloutMode) === "shadow" ? "SHADOW" : setting.rolloutPercentage >= 100 ? "FULL" : "PERCENTAGE",
        rolloutPercentage: setting.rolloutPercentage,
		eventTypes: [setting.scenario.eventType],
		allowedOperations: spec.agent.allowedOperations,
		deliverySurfaces: spec.delivery.surfaces,
		dedupeWindowSeconds: spec.dedupe.cooldownSeconds,
		rateLimitPerHour: setting.maxRunsPerHour,
		timeoutSeconds: spec.agent.timeoutSeconds,
		lastRunAt: runs[0]?.createdAt ?? null,
		stats: { matched: runs.length, completed, failed: runs.filter((run) => run.status === "FAILED").length, successRate: runs.length ? Math.round((completed / runs.length) * 1_000) / 10 : 0, avgDurationSeconds: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 1000) : 0 }
      };
    });
    return {
      scenarios,
	  packages: packages.map((item) => ({ key: item.packageKey, version: item.version, digest: item.digest, status: item.status, createdAt: item.createdAt })),
	  runs: recentRuns.map((run) => ({
        id: run.id,
        scenarioKey: run.scenarioKey,
        scenarioVersion: run.scenarioVersion,
		status: run.status,
        rolloutMode: run.rolloutMode,
        rolloutPercentage: run.rolloutPercentage,
        traceId: run.traceId,
		createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
		errorCode: run.error && typeof run.error === "object" && !Array.isArray(run.error) ? String((run.error as Record<string, unknown>).code ?? "") : "",
        packageDigest: run.packageDigest,
        handbookDigest: run.handbookDigest
      })),
      connectorHealth: heartbeat ? {
		status: Date.now() - heartbeat.lastSeenAt.getTime() <= 90_000 ? "HEALTHY" : "STALE",
        workerId: heartbeat.workerId,
        handbookDigest: heartbeat.handbookDigest,
        queueDepth: heartbeat.queueDepth,
        details: heartbeat.details,
		lastHeartbeatAt: heartbeat.lastSeenAt
	  } : { status: "UNKNOWN", queueDepth: 0, lastHeartbeatAt: null },
	  stats: { runs24h: recentRuns.filter((run) => run.createdAt >= since).length }
    };
  }
}
