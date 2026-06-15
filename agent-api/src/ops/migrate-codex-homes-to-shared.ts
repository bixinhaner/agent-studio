import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { appConfig } from "../config.js";
import { createDbClient } from "../db/client.js";
import { NativeCodexSkillService, type MaterializedCodexSkillInput } from "../codex-skills/native-codex-skill-service.js";
import {
  buildSharedCodexHomeScope,
  buildSharedIntegrationCodexHomeScope,
  sanitizePathSegment
} from "../runtime-scope-resolver.js";

type SourceKind = "session" | "thread";

type ReferenceRow = {
  source: SourceKind;
  recordId: string;
  threadId: string | null;
  organizationId: string | null;
  organizationSlug: string | null;
  userId: string | null;
  workspace: string | null;
  codexRunConfig: unknown;
  currentHome: string | null;
};

type MigrationTarget =
  | {
      kind: "user";
      modeId: string;
      targetHome: string;
      scopeSegments: string[];
    }
  | {
      kind: "integration";
      provider: string;
      integrationInstanceId: string;
      modeId: string;
      targetHome: string;
      scopeSegments: string[];
    };

type CopyStats = {
  directoriesCreated: number;
  filesCopied: number;
  filesSkipped: number;
  missingSources: number;
};

type CliOptions = {
  apply: boolean;
  includeMissingHome: boolean;
  limit?: number;
  skipZendesk: boolean;
};

const STATE_DIRECTORIES_TO_MERGE = ["sessions", "memories", "shell_snapshots"];

function usage(): never {
  console.error([
    "Usage: node dist/ops/migrate-codex-homes-to-shared.js [--dry-run|--apply] [--include-missing-home] [--limit <n>] [--skip-zendesk]",
    "",
    "Migrates historical per-thread/per-workspace CODEX_HOME references to shared CODEX_HOME scopes.",
    "Dry-run is the default. --apply materializes target homes, merges session state, and updates DB references.",
    "--include-missing-home also backfills old records that predate _agentStudioCodexHome metadata."
  ].join("\n"));
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { apply: false, includeMissingHome: false, skipZendesk: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      out.apply = false;
      continue;
    }
    if (arg === "--apply") {
      out.apply = true;
      continue;
    }
    if (arg === "--include-missing-home") {
      out.includeMissingHome = true;
      continue;
    }
    if (arg === "--skip-zendesk") {
      out.skipZendesk = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[index + 1];
      if (!raw) usage();
      const limit = Number.parseInt(raw, 10);
      if (!Number.isFinite(limit) || limit <= 0) usage();
      out.limit = limit;
      index += 1;
      continue;
    }
    usage();
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function modeIdFromRunConfig(codexRunConfig?: Record<string, unknown>): string {
  const raw = codexRunConfig?.mode;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "default";
}

function enabledSkillsFromRunConfig(codexRunConfig?: Record<string, unknown>): MaterializedCodexSkillInput[] {
  const raw = codexRunConfig?.enabledSkills;
  if (!Array.isArray(raw)) return [];
  const out: MaterializedCodexSkillInput[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const name = trimOrUndefined(item);
      if (name) out.push({ name });
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const name =
      trimOrUndefined(typeof record.name === "string" ? record.name : undefined) ??
      trimOrUndefined(typeof record.skillName === "string" ? record.skillName : undefined);
    if (!name) continue;
    out.push({
      name,
      sourcePath: trimOrUndefined(typeof record.sourcePath === "string" ? record.sourcePath : undefined),
      relativePath: trimOrUndefined(typeof record.relativePath === "string" ? record.relativePath : undefined),
      system: record.system === true
    });
  }
  return out;
}

function isUnderRoot(rootPath: string, candidatePath: string): boolean {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function topLevelCodexHomeSegment(rootPath: string, homePath: string): string | undefined {
  if (!isUnderRoot(rootPath, homePath)) return undefined;
  const relative = path.relative(path.resolve(rootPath), path.resolve(homePath));
  const [first] = relative.split(path.sep).filter(Boolean);
  return first;
}

function isLegacyTopLevelHome(rootPath: string, homePath: string): boolean {
  const first = topLevelCodexHomeSegment(rootPath, homePath);
  return Boolean(
    first?.startsWith("thread-") ||
    first?.startsWith("workspace-") ||
    first?.startsWith("zendesk-")
  );
}

function parseZendeskInstanceId(input: { workspace?: string | null; currentHome?: string | null }): string | undefined {
  const workspace = trimOrUndefined(input.workspace);
  if (workspace) {
    const normalized = workspace.split(path.sep).join("/");
    const match = normalized.match(/\/sessions\/zendesk\/([^/]+)\/tickets\/ticket-[^/]+$/);
    if (match?.[1]) return match[1];
  }

  const home = trimOrUndefined(input.currentHome);
  if (home) {
    const base = path.basename(home);
    const match = base.match(/^zendesk-(.+)-ticket-.+$/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function resolveMigrationTarget(row: ReferenceRow, codexRunConfig: Record<string, unknown>): MigrationTarget | undefined {
  const modeId = modeIdFromRunConfig(codexRunConfig);
  const organizationId = trimOrUndefined(row.organizationId);
  const userId = trimOrUndefined(row.userId);
  if (organizationId && userId) {
    const scope = buildSharedCodexHomeScope({
      actor: {
        organizationId,
        organizationSlug: trimOrUndefined(row.organizationSlug),
        userId
      },
      modeId,
      codexRunConfig
    });
    return {
      kind: "user",
      modeId,
      scopeSegments: scope.scopeSegments,
      targetHome: path.join(appConfig.codex.sessionHomeRoot, ...scope.scopeSegments)
    };
  }

  const zendeskInstanceId = parseZendeskInstanceId({ workspace: row.workspace, currentHome: row.currentHome });
  if (zendeskInstanceId) {
    const scope = buildSharedIntegrationCodexHomeScope({
      provider: "zendesk",
      integrationInstanceId: zendeskInstanceId,
      modeId,
      codexRunConfig
    });
    return {
      kind: "integration",
      provider: "zendesk",
      integrationInstanceId: zendeskInstanceId,
      modeId,
      scopeSegments: scope.scopeSegments,
      targetHome: path.join(appConfig.codex.sessionHomeRoot, ...scope.scopeSegments)
    };
  }

  return undefined;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyEntryIfMissing(sourcePath: string, targetPath: string, stats: CopyStats): Promise<void> {
  const sourceStat = await fs.lstat(sourcePath).catch(() => undefined);
  if (!sourceStat) {
    stats.missingSources += 1;
    return;
  }

  if (sourceStat.isDirectory()) {
    if (!(await pathExists(targetPath))) {
      await fs.mkdir(targetPath, { recursive: true });
      stats.directoriesCreated += 1;
    }
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await copyEntryIfMissing(path.join(sourcePath, entry.name), path.join(targetPath, entry.name), stats);
    }
    return;
  }

  if (await pathExists(targetPath)) {
    stats.filesSkipped += 1;
    return;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  if (sourceStat.isSymbolicLink()) {
    const linkTarget = await fs.readlink(sourcePath);
    await fs.symlink(linkTarget, targetPath);
  } else if (sourceStat.isFile()) {
    await fs.copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
  } else {
    stats.filesSkipped += 1;
    return;
  }
  stats.filesCopied += 1;
}

async function mergeCodexHomeState(sourceHome: string, targetHome: string): Promise<CopyStats> {
  const stats: CopyStats = {
    directoriesCreated: 0,
    filesCopied: 0,
    filesSkipped: 0,
    missingSources: 0
  };
  for (const directory of STATE_DIRECTORIES_TO_MERGE) {
    const sourcePath = path.join(sourceHome, directory);
    if (!(await pathExists(sourcePath))) continue;
    await copyEntryIfMissing(sourcePath, path.join(targetHome, directory), stats);
  }
  return stats;
}

function printMetric(name: string, value: string | number): void {
  console.log(`${name}|${value}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  const nativeCodexSkills = new NativeCodexSkillService(appConfig.codex);
  const rootPath = path.resolve(appConfig.codex.sessionHomeRoot);

  try {
    const rows = await db.$queryRaw<ReferenceRow[]>`
      select
        'session' as "source",
        rs.external_id as "recordId",
        rs.thread_id as "threadId",
        coalesce(rs.organization_id, t.organization_id) as "organizationId",
        o.slug as "organizationSlug",
        coalesce(rs.user_id, t.user_id) as "userId",
        rs.metadata->>'workspace' as "workspace",
        rs.metadata->'codexRunConfig' as "codexRunConfig",
        rs.metadata->'codexRunConfig'->>'_agentStudioCodexHome' as "currentHome"
      from runtime_sessions rs
      left join threads t on t.id = rs.thread_id
      left join organizations o on o.id = coalesce(rs.organization_id, t.organization_id)
      where
        (rs.metadata->'codexRunConfig')::jsonb ? '_agentStudioCodexHome'
        or (
          ${options.includeMissingHome}::boolean
          and rs.provider = 'codex'
          and rs.metadata->>'codexThreadId' is not null
          and rs.metadata->'codexRunConfig' is not null
          and not ((rs.metadata->'codexRunConfig')::jsonb ? '_agentStudioCodexHome')
        )
      union all
      select
        'thread' as "source",
        th.id as "recordId",
        th.id as "threadId",
        th.organization_id as "organizationId",
        o.slug as "organizationSlug",
        th.user_id as "userId",
        th.workspace as "workspace",
        th.codex_run_config as "codexRunConfig",
        th.codex_run_config->>'_agentStudioCodexHome' as "currentHome"
      from threads th
      left join organizations o on o.id = th.organization_id
      where
        th.codex_run_config::jsonb ? '_agentStudioCodexHome'
        or (
          ${options.includeMissingHome}::boolean
          and th.codex_run_config is not null
          and not (th.codex_run_config::jsonb ? '_agentStudioCodexHome')
        )
      order by "source", "recordId"
    `;

    const targetHomes = new Set<string>();
    const oldSourceHomes = new Set<string>();
    const materializedTargets = new Set<string>();
    const mergedPairs = new Set<string>();
    const stats = {
      totalReferences: rows.length,
      alreadyShared: 0,
      skippedNonLegacy: 0,
      skippedMissingHome: 0,
      skippedMissingConfig: 0,
      skippedMissingTarget: 0,
      skippedZendesk: 0,
      missingHomeBackfills: 0,
      plannedReferences: 0,
      updatedSessions: 0,
      updatedThreads: 0,
      mergeSources: 0,
      copyDirectoriesCreated: 0,
      copyFilesCopied: 0,
      copyFilesSkipped: 0
    };

    for (const row of rows) {
      if (options.limit !== undefined && stats.plannedReferences >= options.limit) break;

      const currentHome = trimOrUndefined(row.currentHome);
      if (!currentHome) {
        if (!options.includeMissingHome) {
          stats.skippedMissingHome += 1;
          continue;
        }
        stats.missingHomeBackfills += 1;
      }
      if (currentHome && !isLegacyTopLevelHome(rootPath, currentHome)) {
        stats.alreadyShared += 1;
        continue;
      }
      if (currentHome && !isUnderRoot(rootPath, currentHome)) {
        stats.skippedNonLegacy += 1;
        continue;
      }

      const codexRunConfig = asRecord(row.codexRunConfig);
      if (!codexRunConfig) {
        stats.skippedMissingConfig += 1;
        continue;
      }

      const target = resolveMigrationTarget(row, codexRunConfig);
      if (!target) {
        stats.skippedMissingTarget += 1;
        continue;
      }
      if (target.kind === "integration" && target.provider === "zendesk" && options.skipZendesk) {
        stats.skippedZendesk += 1;
        continue;
      }
      if (currentHome && path.resolve(currentHome) === path.resolve(target.targetHome)) {
        stats.alreadyShared += 1;
        continue;
      }

      stats.plannedReferences += 1;
      targetHomes.add(target.targetHome);
      if (currentHome) {
        oldSourceHomes.add(currentHome);
      }

      if (!options.apply) continue;

      if (!materializedTargets.has(target.targetHome)) {
        const materializedHome = await nativeCodexSkills.materializeSessionHome({
          scopeSegments: target.scopeSegments,
          enabledSkills: enabledSkillsFromRunConfig(codexRunConfig)
        });
        if (path.resolve(materializedHome) !== path.resolve(target.targetHome)) {
          throw new Error(`Unexpected materialized CODEX_HOME: ${materializedHome} != ${target.targetHome}`);
        }
        materializedTargets.add(target.targetHome);
      }

      if (currentHome) {
        const mergeKey = `${path.resolve(currentHome)}\n${path.resolve(target.targetHome)}`;
        if (!mergedPairs.has(mergeKey)) {
          const copyStats = await mergeCodexHomeState(currentHome, target.targetHome);
          stats.mergeSources += 1;
          stats.copyDirectoriesCreated += copyStats.directoriesCreated;
          stats.copyFilesCopied += copyStats.filesCopied;
          stats.copyFilesSkipped += copyStats.filesSkipped;
          mergedPairs.add(mergeKey);
        }
      }

      if (row.source === "session") {
        await db.$executeRaw`
          update runtime_sessions
          set metadata = jsonb_set(metadata::jsonb, '{codexRunConfig,_agentStudioCodexHome}', to_jsonb(${target.targetHome}::text), true)
          where external_id = ${row.recordId}
        `;
        stats.updatedSessions += 1;
      } else {
        await db.$executeRaw`
          update threads
          set codex_run_config = jsonb_set(codex_run_config::jsonb, '{_agentStudioCodexHome}', to_jsonb(${target.targetHome}::text), true)
          where id = ${row.recordId}
        `;
        stats.updatedThreads += 1;
      }
    }

    printMetric("mode", options.apply ? "apply" : "dry-run");
    printMetric("codex_home_root", rootPath);
    printMetric("references_total", stats.totalReferences);
    printMetric("references_planned", stats.plannedReferences);
    printMetric("target_homes", targetHomes.size);
    printMetric("old_source_homes", oldSourceHomes.size);
    printMetric("already_shared_or_nonlegacy", stats.alreadyShared + stats.skippedNonLegacy);
    printMetric("skipped_missing_home", stats.skippedMissingHome);
    printMetric("missing_home_backfills", stats.missingHomeBackfills);
    printMetric("skipped_missing_config", stats.skippedMissingConfig);
    printMetric("skipped_missing_target", stats.skippedMissingTarget);
    printMetric("skipped_zendesk", stats.skippedZendesk);
    printMetric("updated_sessions", stats.updatedSessions);
    printMetric("updated_threads", stats.updatedThreads);
    printMetric("merge_sources", stats.mergeSources);
    printMetric("copy_directories_created", stats.copyDirectoriesCreated);
    printMetric("copy_files_copied", stats.copyFilesCopied);
    printMetric("copy_files_skipped", stats.copyFilesSkipped);
    printMetric("sample_targets", [...targetHomes].slice(0, 10).map((item) => path.relative(rootPath, item)).join(","));
    printMetric(
      "sample_old_sources",
      [...oldSourceHomes].slice(0, 10).map((item) => path.relative(rootPath, item)).join(",")
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
