import fs from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import {
  type ManagedSkillReferenceMapping,
  rewriteManagedSkillReferences
} from "../codex-skills/package-sharing-migration.js";
import { createDbClient } from "../db/client.js";

type CliOptions = {
  apply: boolean;
  report?: string;
};

type RunConfigRow = {
  id: string;
  runConfig: unknown;
};

function usage(): never {
  console.error([
    "Usage: node dist/ops/backfill-managed-skill-references.js [--dry-run|--apply] [--report <path>]",
    "",
    "Dry-run is the default. The backfill updates historical thread/message run configs that still",
    "refer to superseded agent_mode Skill records after migration to private Skills with member grants."
  ].join("\n"));
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.apply = false;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--report") {
      const value = argv[index + 1]?.trim();
      if (!value) usage();
      options.report = path.resolve(value);
      index += 1;
    } else usage();
  }
  return options;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const raw = record(value)?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

async function writeReport(reportPath: string | undefined, report: unknown): Promise<void> {
  if (!reportPath) return;
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function candidatePredicate(column: Prisma.Sql, sourceIds: string[]): Prisma.Sql {
  return Prisma.join(sourceIds.map((sourceId) => Prisma.sql`${column}::text LIKE ${`%${sourceId}%`}`), " OR ");
}

async function findCandidateRows(
  db: ReturnType<typeof createDbClient>,
  table: "threads" | "messages",
  column: "codex_run_config" | "run_config",
  sourceIds: string[]
): Promise<RunConfigRow[]> {
  if (sourceIds.length === 0) return [];
  const predicate = candidatePredicate(Prisma.raw(column), sourceIds);
  if (table === "threads") {
    return db.$queryRaw<RunConfigRow[]>(Prisma.sql`
      SELECT id, codex_run_config AS "runConfig"
      FROM threads
      WHERE codex_run_config IS NOT NULL AND (${predicate})
      ORDER BY created_at ASC, id ASC
    `);
  }
  return db.$queryRaw<RunConfigRow[]>(Prisma.sql`
    SELECT id, run_config AS "runConfig"
    FROM messages
    WHERE run_config IS NOT NULL AND (${predicate})
    ORDER BY created_at ASC, id ASC
  `);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  const report: Record<string, unknown> = {
    mode: options.apply ? "apply" : "dry-run",
    startedAt: new Date().toISOString()
  };

  try {
    const archivedSources = await db.codexManagedSkill.findMany({
      where: { scope: "agent_mode", status: "archived" },
      orderBy: [{ skillName: "asc" }, { id: "asc" }]
    });
    const sourceToTargetId = archivedSources
      .map((source) => ({
        source,
        targetId: stringField(source.metadata, "replacementManagedSkillId"),
        migrationAction: stringField(source.metadata, "migrationAction")
      }))
      .filter((item): item is typeof item & { targetId: string } =>
        item.migrationAction === "restored_private_with_member_grants" && Boolean(item.targetId));
    const targetIds = [...new Set(sourceToTargetId.map((item) => item.targetId))];
    const targets = await db.codexManagedSkill.findMany({ where: { id: { in: targetIds } } });
    const targetById = new Map(targets.map((target) => [target.id, target] as const));
    const blockers: string[] = [];
    const mappings: ManagedSkillReferenceMapping[] = [];
    for (const item of sourceToTargetId) {
      const target = targetById.get(item.targetId);
      if (!target) {
        blockers.push(`迁移来源 ${item.source.id} 指向不存在的 Skill ${item.targetId}`);
        continue;
      }
      if (target.scope !== "private" || target.status !== "active") {
        blockers.push(`目标 Skill ${target.id} 不是 active private`);
        continue;
      }
      if (target.skillName !== item.source.skillName) {
        blockers.push(`Skill ${item.source.id} 与目标 ${target.id} 名称不一致`);
        continue;
      }
      const skillEntry = await fs.stat(path.join(target.publishedPath, "SKILL.md")).catch(() => undefined);
      if (!skillEntry?.isFile()) {
        blockers.push(`目标 Skill ${target.id} 缺少可读取的 SKILL.md：${target.publishedPath}`);
        continue;
      }
      mappings.push({
        sourceManagedSkillId: item.source.id,
        targetManagedSkillId: target.id,
        targetSourcePath: target.publishedPath
      });
    }

    const sourceIds = mappings.map((mapping) => mapping.sourceManagedSkillId);
    const [threadCandidates, messageCandidates] = await Promise.all([
      findCandidateRows(db, "threads", "codex_run_config", sourceIds),
      findCandidateRows(db, "messages", "run_config", sourceIds)
    ]);
    const threadUpdates = threadCandidates
      .map((row) => ({ id: row.id, ...rewriteManagedSkillReferences(row.runConfig, mappings) }))
      .filter((row) => row.changed);
    const messageUpdates = messageCandidates
      .map((row) => ({ id: row.id, ...rewriteManagedSkillReferences(row.runConfig, mappings) }))
      .filter((row) => row.changed);
    const affectedBySourceId = new Map<string, { threads: number; messages: number }>(
      sourceIds.map((sourceId) => [sourceId, { threads: 0, messages: 0 }])
    );
    for (const row of threadUpdates) {
      for (const sourceId of row.rewrittenSkillIds) affectedBySourceId.get(sourceId)!.threads += 1;
    }
    for (const row of messageUpdates) {
      for (const sourceId of row.rewrittenSkillIds) affectedBySourceId.get(sourceId)!.messages += 1;
    }
    Object.assign(report, {
      mappings,
      threadRunConfigsToUpdate: threadUpdates.length,
      messageRunConfigsToUpdate: messageUpdates.length,
      affectedBySourceId: Object.fromEntries(affectedBySourceId),
      sampleThreadIds: threadUpdates.slice(0, 10).map((row) => row.id),
      sampleMessageIds: messageUpdates.slice(0, 10).map((row) => row.id),
      blockers
    });

    if (blockers.length > 0) {
      await writeReport(options.report, report);
      console.log(JSON.stringify(report, null, 2));
      throw new Error(`回填预检失败，共 ${blockers.length} 个阻断项`);
    }
    if (!options.apply) {
      await writeReport(options.report, report);
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    await db.$transaction(async (tx) => {
      for (const row of threadUpdates) {
        await tx.thread.update({
          where: { id: row.id },
          data: { codexRunConfig: row.runConfig as Prisma.InputJsonValue }
        });
      }
      for (const row of messageUpdates) {
        await tx.message.update({
          where: { id: row.id },
          data: { runConfig: row.runConfig as Prisma.InputJsonValue }
        });
      }
    }, { timeout: 120_000 });

    const [remainingThreadCandidates, remainingMessageCandidates] = await Promise.all([
      findCandidateRows(db, "threads", "codex_run_config", sourceIds),
      findCandidateRows(db, "messages", "run_config", sourceIds)
    ]);
    const remainingThreads = remainingThreadCandidates.filter((row) =>
      rewriteManagedSkillReferences(row.runConfig, mappings).changed);
    const remainingMessages = remainingMessageCandidates.filter((row) =>
      rewriteManagedSkillReferences(row.runConfig, mappings).changed);
    Object.assign(report, {
      completedAt: new Date().toISOString(),
      applied: true,
      verification: {
        updatedThreads: threadUpdates.length,
        updatedMessages: messageUpdates.length,
        remainingThreadRunConfigs: remainingThreads.length,
        remainingMessageRunConfigs: remainingMessages.length
      }
    });
    await writeReport(options.report, report);
    console.log(JSON.stringify(report, null, 2));
    if (remainingThreads.length > 0 || remainingMessages.length > 0) {
      throw new Error("回填已执行，但仍存在旧 Skill 引用");
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
