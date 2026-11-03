import fs from "node:fs/promises";
import path from "node:path";

import { sanitizePathSegment } from "./runtime-scope-resolver.js";

// Removes the disk data of portal tasks that have sat in the trash (status archived) longer than
// ARCHIVED_THREAD_RETENTION_DAYS: the thread workspace (or the thread's upload folder when the
// workspace is shared), the upload temp dir, and the thread's Codex rollouts, generated images and
// shell snapshots. Thread rows and messages are kept; archived_data_purged_at hides the task from
// the trash. Tasks inside a trashed workspace folder follow the folder's own 30-day purge.

export type PurgeThreadRow = {
  id: string;
  status: string;
  workspace: string | null;
  codexThreadId: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
  archivedDataPurgedAt: Date | null;
  workspaceTrashBatchId: string | null;
  lastMessageAt: Date | null;
  lastSessionAt: Date | null;
};

export type PurgePlan = {
  threadIds: string[];
  // Dedicated workspaces no other thread can reach.
  workspaces: string[];
  // <shared workspace>/.agent-studio/uploads/<thread> folders.
  uploadDirs: string[];
  codexThreadIds: string[];
};

function isPurgeCandidate(row: PurgeThreadRow, cutoff: number): boolean {
  if (row.status !== "archived" || row.archivedDataPurgedAt || row.workspaceTrashBatchId) return false;
  const archivedAt = (row.archivedAt ?? row.updatedAt).getTime();
  return (
    archivedAt < cutoff &&
    (row.lastMessageAt?.getTime() ?? 0) < cutoff &&
    (row.lastSessionAt?.getTime() ?? 0) < cutoff
  );
}

// Dedicated thread workspaces: thread-* dirs and connector conversations under a sessions root.
function isDedicatedWorkspace(workspace: string): boolean {
  const segments = workspace.split(path.sep);
  const sessionsIndex = segments.lastIndexOf("sessions");
  if (sessionsIndex < 0 || sessionsIndex >= segments.length - 2) return false;
  const name = segments[segments.length - 1] ?? "";
  return name.startsWith("thread-") || segments[segments.length - 2] === "conversations";
}

export function planArchivedThreadPurge(input: {
  threads: PurgeThreadRow[];
  // Codex thread ids recorded on runtime sessions, by Agent Studio thread id.
  sessionCodexThreadIds: Array<{ threadId: string; codexThreadId: string }>;
  now: Date;
  retentionDays: number;
}): PurgePlan {
  const cutoff = input.now.getTime() - input.retentionDays * 24 * 60 * 60 * 1000;
  const candidates = new Set<string>();
  const purged = new Set<string>();
  // Threads whose data must survive: everything except purge candidates and already purged tasks.
  const blockingWorkspaces = new Set<string>();
  for (const row of input.threads) {
    if (isPurgeCandidate(row, cutoff)) {
      candidates.add(row.id);
      continue;
    }
    if (row.status === "archived" && row.archivedDataPurgedAt) {
      purged.add(row.id);
      continue;
    }
    if (row.workspace?.trim()) blockingWorkspaces.add(path.resolve(row.workspace));
  }
  const blockingSorted = [...blockingWorkspaces].sort();
  const reachableByBlocking = (workspace: string) => {
    for (let current = workspace; current !== path.dirname(current); current = path.dirname(current)) {
      if (blockingWorkspaces.has(current)) return true;
    }
    const prefix = `${workspace}${path.sep}`;
    let low = 0;
    let high = blockingSorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (blockingSorted[middle] < prefix) low = middle + 1;
      else high = middle;
    }
    return low < blockingSorted.length && blockingSorted[low].startsWith(prefix);
  };

  const workspaces = new Set<string>();
  const uploadDirs = new Set<string>();
  for (const row of input.threads) {
    if (!candidates.has(row.id) || !row.workspace?.trim()) continue;
    const workspace = path.resolve(row.workspace);
    if (isDedicatedWorkspace(workspace) && !reachableByBlocking(workspace)) {
      workspaces.add(workspace);
    } else {
      uploadDirs.add(path.join(workspace, ".agent-studio", "uploads", sanitizePathSegment(row.id, "thread")));
    }
  }
  for (const directory of [...uploadDirs]) {
    if ([...workspaces].some((workspace) => directory.startsWith(`${workspace}${path.sep}`))) uploadDirs.delete(directory);
  }

  const codexOwners = new Map<string, Set<string>>();
  const addCodex = (codexThreadId: string | null | undefined, threadId: string) => {
    const id = codexThreadId?.trim();
    if (!id) return;
    const owners = codexOwners.get(id) ?? new Set<string>();
    owners.add(threadId);
    codexOwners.set(id, owners);
  };
  for (const row of input.threads) addCodex(row.codexThreadId, row.id);
  for (const session of input.sessionCodexThreadIds) addCodex(session.codexThreadId, session.threadId);
  const codexThreadIds: string[] = [];
  for (const [codexThreadId, owners] of codexOwners) {
    if ([...owners].some((owner) => candidates.has(owner)) && [...owners].every((owner) => candidates.has(owner) || purged.has(owner))) {
      codexThreadIds.push(codexThreadId);
    }
  }

  return {
    threadIds: [...candidates].sort(),
    workspaces: [...workspaces].sort(),
    uploadDirs: [...uploadDirs].sort(),
    codexThreadIds: codexThreadIds.sort()
  };
}

export type RemovalTotals = { paths: number; bytes: number };

async function pathBytes(target: string): Promise<number> {
  const stat = await fs.lstat(target).catch(() => undefined);
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of await fs.readdir(target).catch(() => [] as string[])) {
    total += await pathBytes(path.join(target, entry));
  }
  return total;
}

export async function removePaths(paths: string[], dryRun: boolean): Promise<RemovalTotals> {
  const totals: RemovalTotals = { paths: 0, bytes: 0 };
  for (const target of paths) {
    const stat = await fs.lstat(target).catch(() => undefined);
    if (!stat) continue;
    // lstat/rm never follow a symlink, so a planted link is removed without touching its target.
    totals.bytes += await pathBytes(target);
    totals.paths += 1;
    if (!dryRun) await fs.rm(target, { recursive: true, force: true });
  }
  return totals;
}

const CODEX_HOME_SKIPPED_DIRS = new Set(["plugins", "cache", "skills", "memories", ".tmp", "tmp", "node_modules", ".agent-studio"]);
const ROLLOUT_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl/;

// Finds rollouts, generated images and shell snapshots of the given Codex threads in every
// Codex home below root.
export async function findCodexThreadArtifacts(root: string, codexThreadIds: Set<string>): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, inSessions: boolean): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (inSessions) {
        if (entry.isDirectory()) await walk(absolute, true);
        else if (entry.isFile()) {
          const match = ROLLOUT_PATTERN.exec(entry.name);
          if (match && codexThreadIds.has(match[1])) found.push(absolute);
        }
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (entry.name === "sessions" || entry.name === "archived_sessions") {
        await walk(absolute, true);
      } else if (entry.name === "generated_images") {
        for (const child of await fs.readdir(absolute).catch(() => [] as string[])) {
          if (codexThreadIds.has(child)) found.push(path.join(absolute, child));
        }
      } else if (entry.name === "shell_snapshots") {
        for (const child of await fs.readdir(absolute).catch(() => [] as string[])) {
          if (codexThreadIds.has(child.split(".")[0] ?? "")) found.push(path.join(absolute, child));
        }
      } else if (!CODEX_HOME_SKIPPED_DIRS.has(entry.name)) {
        await walk(absolute, false);
      }
    }
  };
  await walk(path.resolve(root), false);
  return found.sort();
}
