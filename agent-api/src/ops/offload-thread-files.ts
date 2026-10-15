import fs from "node:fs/promises";
import path from "node:path";

import { appConfig } from "../config.js";
import { createDbClient } from "../db/client.js";
import {
  collectOffloadGarbage,
  listOffloadedChecksums,
  offloadThreadWorkspace,
  type OffloadCandidateLookup
} from "../thread-file-offload.js";
import { LocalFsWorkspaceStorage } from "../workspaces/storage.js";

// Daily job (agent-studio-thread-file-offload.timer): offloads uploads and deliverables of idle
// thread workspaces (thread dirs, connector conversations, legacy shared agent dirs) whose bytes
// already exist in user-workspace storage, then drops unreferenced objects
// from the offload store. Restoring happens in the app before a thread is used or read again.

type CliOptions = { apply: boolean; idleDays: number; minBytes: number; limit?: number };

type ThreadRow = { workspace: string; lastAt: Date };
type VersionRow = { checksum: string; sizeBytes: bigint; storageKey: string };

function usage(): never {
  console.error(
    "Usage: node dist/ops/offload-thread-files.js [--dry-run|--apply] [--idle-days <n>] [--min-bytes <n>] [--limit <n>]"
  );
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, idleDays: 30, minBytes: 64 * 1024 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 0) usage();
      return value;
    };
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--idle-days") options.idleDays = Math.max(7, next());
    else if (arg === "--min-bytes") options.minBytes = next();
    else if (arg === "--limit") options.limit = next();
    else usage();
  }
  return options;
}

type IdleWorkspace = { workspace: string; nested: string[] };

// Thread dirs (thread-*), action-connector conversations (agent-*/conversations/<id>) and legacy
// shared agent dirs (agent-*) under a sessions root.
function isThreadWorkspacePath(workspace: string): boolean {
  const segments = workspace.split(path.sep);
  if (!segments.includes("sessions")) return false;
  const name = segments[segments.length - 1] ?? "";
  return name.startsWith("thread-") || name.startsWith("agent-") || segments[segments.length - 2] === "conversations";
}

// A workspace is offloadable when none of its threads, nor those of an enclosing legacy
// workspace, saw a message within the idle window. Workspaces nested inside it are skipped by the
// walk and handled on their own.
function idleWorkspaces(rows: ThreadRow[], cutoff: Date): IdleWorkspace[] {
  const lastByWorkspace = new Map<string, number>();
  for (const row of rows) {
    const workspace = path.resolve(row.workspace);
    lastByWorkspace.set(workspace, Math.max(lastByWorkspace.get(workspace) ?? 0, row.lastAt.getTime()));
  }
  const sorted = [...lastByWorkspace.keys()].sort();
  const nestedWorkspaces = (workspace: string) => {
    const prefix = `${workspace}${path.sep}`;
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle] < prefix) low = middle + 1;
      else high = middle;
    }
    const nested: string[] = [];
    for (let index = low; index < sorted.length && sorted[index].startsWith(prefix); index += 1) {
      nested.push(sorted[index]);
    }
    return nested;
  };
  const result: IdleWorkspace[] = [];
  for (const [workspace, lastAt] of lastByWorkspace) {
    if (!isThreadWorkspacePath(workspace)) continue;
    let effective = lastAt;
    for (let parent = path.dirname(workspace); parent !== path.dirname(parent); parent = path.dirname(parent)) {
      effective = Math.max(effective, lastByWorkspace.get(parent) ?? 0);
    }
    if (effective < cutoff.getTime()) result.push({ workspace, nested: nestedWorkspaces(workspace) });
  }
  return result.sort((left, right) => left.workspace.localeCompare(right.workspace));
}

async function isPlainDirectory(workspace: string): Promise<boolean> {
  const stat = await fs.lstat(workspace).catch(() => undefined);
  if (!stat?.isDirectory()) return false;
  return (await fs.realpath(workspace).catch(() => "")) === workspace;
}

async function writeState(summary: Record<string, unknown>): Promise<void> {
  const stateRoot = appConfig.sharedRuntime.stateRoot;
  if (!(await fs.stat(stateRoot).catch(() => undefined))) return;
  const target = path.join(stateRoot, "thread-offload-last-run.json");
  const temporary = path.join(stateRoot, `.thread-offload-last-run.${process.pid}`);
  await fs.writeFile(temporary, `${JSON.stringify(summary)}\n`, { mode: 0o644 });
  await fs.rename(temporary, target);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  const storage = new LocalFsWorkspaceStorage(appConfig.userWorkspaceStorageRoot);
  const offloadRoot = appConfig.threadOffloadRoot;
  const startedAt = Date.now();
  try {
    const rows = await db.$queryRaw<ThreadRow[]>`
      select t.workspace as "workspace",
             greatest(t.created_at, coalesce(max(m.created_at), t.created_at)) as "lastAt"
      from threads t
      left join messages m on m.thread_id = t.id
      where t.workspace is not null and t.workspace <> ''
      group by t.id`;
    const versions = await db.$queryRaw<VersionRow[]>`
      select checksum, size_bytes as "sizeBytes", storage_key as "storageKey" from workspace_file_versions`;

    const storageKeyByChecksum = new Map<string, string>();
    const sizes = new Set<number>();
    for (const version of versions) {
      if (!/^[a-f0-9]{64}$/.test(version.checksum)) continue;
      storageKeyByChecksum.set(version.checksum, version.storageKey);
      sizes.add(Number(version.sizeBytes));
    }
    const lookup: OffloadCandidateLookup = {
      sizes,
      objectForChecksum: (sha256) => {
        const storageKey = storageKeyByChecksum.get(sha256);
        if (!storageKey) return undefined;
        try {
          return storage.resolve(storageKey);
        } catch {
          return undefined;
        }
      }
    };

    const cutoff = new Date(Date.now() - options.idleDays * 24 * 60 * 60 * 1000);
    let candidates = idleWorkspaces(rows, cutoff);
    if (options.limit !== undefined) candidates = candidates.slice(0, options.limit);

    const totals = { workspaces: 0, files: 0, bytes: 0, hashed: 0, failed: 0 };
    for (const { workspace, nested } of candidates) {
      if (!(await isPlainDirectory(workspace))) continue;
      try {
        const result = await offloadThreadWorkspace({
          workspace,
          excludeDirs: nested,
          offloadRoot,
          lookup,
          minBytes: options.minBytes,
          dryRun: !options.apply
        });
        totals.hashed += result.hashed;
        if (result.files === 0) continue;
        totals.workspaces += 1;
        totals.files += result.files;
        totals.bytes += result.bytes;
        console.log(`${options.apply ? "offloaded" : "would offload"} ${result.files} files ${Math.round(result.bytes / 1048576)}MB ${workspace}`);
      } catch (error) {
        totals.failed += 1;
        console.warn(`failed ${workspace}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const referenced = new Set<string>();
    for (const workspace of new Set(rows.map((row) => path.resolve(row.workspace)))) {
      for (const checksum of await listOffloadedChecksums(workspace)) referenced.add(checksum);
    }
    const garbage = await collectOffloadGarbage(offloadRoot, referenced, !options.apply);

    const summary = {
      finishedAt: new Date().toISOString(),
      dryRun: !options.apply,
      idleDays: options.idleDays,
      candidateThreads: candidates.length,
      offloadedThreads: totals.workspaces,
      offloadedFiles: totals.files,
      offloadedBytes: totals.bytes,
      hashedFiles: totals.hashed,
      failedThreads: totals.failed,
      referencedObjects: referenced.size,
      removedObjects: garbage.removed,
      removedObjectBytes: garbage.bytes,
      durationMs: Date.now() - startedAt
    };
    console.log(`done ${JSON.stringify(summary)}`);
    if (options.apply) await writeState(summary);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
