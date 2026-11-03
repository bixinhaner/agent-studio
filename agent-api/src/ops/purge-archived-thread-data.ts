import fs from "node:fs/promises";
import path from "node:path";

import { ARCHIVED_THREAD_RETENTION_DAYS } from "../archived-thread-retention.js";
import {
  findCodexThreadArtifacts,
  planArchivedThreadPurge,
  removePaths,
  type PurgeThreadRow
} from "../archived-thread-purge.js";
import { appConfig } from "../config.js";
import { createDbClient } from "../db/client.js";

// Daily job (agent-studio-archived-thread-purge.timer): removes disk data of portal tasks that
// have been in the trash longer than ARCHIVED_THREAD_RETENTION_DAYS and hides them from the trash.

function usage(): never {
  console.error("Usage: node dist/ops/purge-archived-thread-data.js [--dry-run|--apply] [--retention-days <n>]");
  process.exit(2);
}

function parseArgs(argv: string[]): { apply: boolean; retentionDays: number } {
  const options = { apply: false, retentionDays: ARCHIVED_THREAD_RETENTION_DAYS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--retention-days") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) usage();
      options.retentionDays = value;
    } else usage();
  }
  return options;
}

async function writeState(summary: Record<string, unknown>): Promise<void> {
  const stateRoot = appConfig.sharedRuntime.stateRoot;
  if (!(await fs.stat(stateRoot).catch(() => undefined))) return;
  const target = path.join(stateRoot, "archived-thread-purge-last-run.json");
  const temporary = path.join(stateRoot, `.archived-thread-purge-last-run.${process.pid}`);
  await fs.writeFile(temporary, `${JSON.stringify(summary)}\n`, { mode: 0o644 });
  await fs.rename(temporary, target);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  const startedAt = Date.now();
  try {
    const threads = await db.$queryRaw<PurgeThreadRow[]>`
      select t.id, t.status::text as status, t.workspace, t.codex_thread_id as "codexThreadId",
             t.archived_at as "archivedAt", t.updated_at as "updatedAt",
             t.archived_data_purged_at as "archivedDataPurgedAt",
             t.workspace_trash_batch_id as "workspaceTrashBatchId",
             (select max(m.created_at) from messages m where m.thread_id = t.id) as "lastMessageAt",
             (select max(s.updated_at) from runtime_sessions s where s.thread_id = t.id) as "lastSessionAt"
      from threads t`;
    const sessionCodexThreadIds = await db.$queryRaw<Array<{ threadId: string; codexThreadId: string }>>`
      select thread_id as "threadId", metadata->>'codexThreadId' as "codexThreadId"
      from runtime_sessions
      where thread_id is not null and metadata->>'codexThreadId' is not null`;
    const plan = planArchivedThreadPurge({
      threads,
      sessionCodexThreadIds,
      now: new Date(),
      retentionDays: options.retentionDays
    });

    // A task restored while the plan was built keeps its data.
    let threadIds = plan.threadIds;
    if (threadIds.length > 0) {
      const still = await db.thread.findMany({
        where: { id: { in: threadIds }, status: "archived", archivedDataPurgedAt: null },
        select: { id: true }
      });
      const stillArchived = new Set(still.map((row) => row.id));
      threadIds = threadIds.filter((id) => stillArchived.has(id));
    }
    const kept = new Set(threadIds);
    const restored = plan.threadIds.filter((id) => !kept.has(id));
    if (restored.length > 0) {
      console.warn(`skipping purge: ${restored.length} task(s) were restored while planning; rerun tomorrow`);
    }

    const dryRun = !options.apply || restored.length > 0;
    const codexArtifacts = await findCodexThreadArtifacts(appConfig.codex.sessionHomeRoot, new Set(plan.codexThreadIds));
    const uploadTempDirs = threadIds.map((id) =>
      path.join(appConfig.uploadTempRoot, id.replace(/[^a-zA-Z0-9_-]/g, "_").trim() || "thread")
    );
    const workspaces = await removePaths(plan.workspaces, dryRun);
    const uploads = await removePaths([...plan.uploadDirs, ...uploadTempDirs], dryRun);
    const codex = await removePaths(codexArtifacts, dryRun);
    if (!dryRun && threadIds.length > 0) {
      await db.thread.updateMany({
        where: { id: { in: threadIds }, status: "archived" },
        data: { archivedDataPurgedAt: new Date() }
      });
    }

    for (const workspace of plan.workspaces) console.log(`${dryRun ? "would remove" : "removed"} workspace ${workspace}`);
    const summary = {
      finishedAt: new Date().toISOString(),
      dryRun,
      retentionDays: options.retentionDays,
      purgedThreads: threadIds.length,
      removedWorkspaces: workspaces.paths,
      removedUploadDirs: uploads.paths,
      removedCodexArtifacts: codex.paths,
      freedBytes: workspaces.bytes + uploads.bytes + codex.bytes,
      durationMs: Date.now() - startedAt
    };
    console.log(`done ${JSON.stringify(summary)}`);
    if (!dryRun) await writeState(summary);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
