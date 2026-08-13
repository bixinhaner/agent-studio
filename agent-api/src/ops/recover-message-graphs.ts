import fs from "node:fs/promises";
import path from "node:path";

import { createDbClient } from "../db/client.js";
import {
  assertRecoveredMessageGraph,
  messageGraphSnapshotSignature,
  planMessageGraphRecovery,
  type RecoverableMessage
} from "../persistence/message-graph-recovery.js";

type CliOptions = {
  apply: boolean;
  outputDir: string;
  threadIds: Set<string>;
  expectedThreads?: number;
};

function usage(): never {
  console.error([
    "Usage: tsx src/ops/recover-message-graphs.ts --output-dir <path> [--dry-run|--apply] [options]",
    "",
    "Options:",
    "  --output-dir <path>     Required private directory for backup and preview files",
    "  --thread-id <id>        Restrict to one thread; may be repeated",
    "  --expected-threads <n>  Refuse apply if the affected count differs",
    "",
    "Dry-run is the default. Apply always writes and fsyncs a complete before-state backup first.",
    "Only missing parents, cycles, duplicate positions, and missing heads are repaired."
  ].join("\n"));
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  let outputDir = "";
  const options: CliOptions = { apply: false, outputDir, threadIds: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.apply = false;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) usage();
      outputDir = path.resolve(value);
      index += 1;
    } else if (arg === "--thread-id") {
      const value = argv[index + 1]?.trim();
      if (!value) usage();
      options.threadIds.add(value);
      index += 1;
    } else if (arg === "--expected-threads") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isFinite(value) || value < 0) usage();
      options.expectedThreads = value;
      index += 1;
    } else usage();
  }
  if (!outputDir) usage();
  options.outputDir = outputDir;
  return options;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2)}\n`;
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const handle = await fs.open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(json(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function recoverableMessages(messages: Array<{
  id: string;
  externalId: string | null;
  role: string;
  parentId: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}>): RecoverableMessage[] {
  return messages.map((message) => ({ ...message }));
}

function rootedHead(plan: ReturnType<typeof planMessageGraphRecovery>): boolean {
  if (!plan.headId) return plan.messages.length === 0;
  const parents = new Map(plan.messages
    .filter((message) => message.externalId)
    .map((message) => [message.externalId!, message.nextParentId]));
  const visited = new Set<string>();
  let cursor: string | null = plan.headId;
  while (cursor) {
    if (visited.has(cursor) || !parents.has(cursor)) return false;
    visited.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return true;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  try {
    const threads = await db.thread.findMany({
      where: options.threadIds.size ? { id: { in: [...options.threadIds] } } : undefined,
      include: {
        messages: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
        artifacts: {
          select: {
            id: true,
            relativePath: true,
            displayName: true,
            sizeBytes: true,
            previewStatus: true,
            downloadStatus: true,
            workspaceFileId: true,
            workspaceFileVersionId: true,
            createdAt: true,
            updatedAt: true
          },
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    const affected = threads.flatMap((thread) => {
      const messages = recoverableMessages(thread.messages);
      const plan = planMessageGraphRecovery({ messages, headId: thread.headId });
      if (!plan.affected) return [];
      assertRecoveredMessageGraph(plan);
      return [{ thread, messages, plan, signature: messageGraphSnapshotSignature(messages) }];
    });

    if (options.expectedThreads !== undefined && options.expectedThreads !== affected.length) {
      throw new Error(`Affected thread guard failed: expected ${options.expectedThreads}, found ${affected.length}`);
    }

    const preview = affected.map(({ thread, plan }) => ({
      threadId: thread.id,
      channel: thread.channel ?? null,
      title: thread.title ?? null,
      userId: thread.userId ?? null,
      reasons: plan.reasons,
      messages: plan.messages.length,
      changedParents: plan.messages.filter((message) => message.parentId !== message.nextParentId).length,
      changedPositions: plan.messages.filter((message) => message.position !== message.nextPosition).length,
      headBefore: thread.headId ?? null,
      headAfter: plan.headId,
      rootedHeadAfter: rootedHead(plan),
      artifacts: thread.artifacts.length,
      readyDownloads: thread.artifacts.filter((artifact) => artifact.downloadStatus === "ready").length
    }));
    const summary = {
      mode: options.apply ? "apply" : "dry-run",
      scannedThreads: threads.length,
      affectedThreads: affected.length,
      affectedUsers: new Set(affected.map(({ thread }) => thread.userId).filter(Boolean)).size,
      affectedByChannel: Object.fromEntries([...new Set(affected.map(({ thread }) => thread.channel ?? "legacy-null"))]
        .sort()
        .map((channel) => [channel, affected.filter(({ thread }) => (thread.channel ?? "legacy-null") === channel).length])),
      reasons: {
        missingParent: affected.filter(({ plan }) => plan.reasons.includes("missing_parent")).length,
        cycle: affected.filter(({ plan }) => plan.reasons.includes("cycle")).length,
        duplicatePosition: affected.filter(({ plan }) => plan.reasons.includes("duplicate_position")).length,
        missingHead: affected.filter(({ plan }) => plan.reasons.includes("missing_head")).length
      },
      rootedHeadsAfter: preview.filter((item) => item.rootedHeadAfter).length,
      totalArtifacts: affected.reduce((sum, { thread }) => sum + thread.artifacts.length, 0),
      generatedAt: new Date().toISOString()
    };

    await fs.mkdir(options.outputDir, { recursive: true, mode: 0o700 });
    await writePrivateJson(path.join(options.outputDir, "preview.json"), { summary, threads: preview });
    await writePrivateJson(path.join(options.outputDir, "before-state.json"), {
      summary,
      threads: affected.map(({ thread, signature, plan }) => ({
        thread: {
          id: thread.id,
          channel: thread.channel,
          title: thread.title,
          userId: thread.userId,
          headId: thread.headId,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt
        },
        signature,
        reasons: plan.reasons,
        messages: thread.messages,
        artifacts: thread.artifacts
      }))
    });

    const applied: string[] = [];
    const skippedConcurrent: string[] = [];
    if (options.apply) {
      for (const candidate of affected) {
        const outcome = await db.$transaction(async (tx) => {
          await tx.$queryRawUnsafe(
            'SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
            `thread-messages:${candidate.thread.id}`
          );
          const current = await tx.thread.findUnique({
            where: { id: candidate.thread.id },
            include: { messages: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] } }
          });
          if (!current) return "concurrent" as const;
          const currentMessages = recoverableMessages(current.messages);
          if (
            current.headId !== candidate.thread.headId ||
            messageGraphSnapshotSignature(currentMessages) !== candidate.signature
          ) return "concurrent" as const;

          for (const planned of candidate.plan.messages) {
            if (planned.parentId === planned.nextParentId && planned.position === planned.nextPosition) continue;
            await tx.message.update({
              where: { id: planned.id },
              data: {
                parentId: planned.nextParentId,
                position: planned.nextPosition,
                updatedAt: planned.updatedAt ? new Date(planned.updatedAt) : undefined
              }
            });
          }
          if (current.headId !== candidate.plan.headId) {
            await tx.thread.update({
              where: { id: current.id },
              data: { headId: candidate.plan.headId, updatedAt: current.updatedAt }
            });
          }
          return "applied" as const;
        });
        if (outcome === "applied") applied.push(candidate.thread.id);
        else skippedConcurrent.push(candidate.thread.id);
      }
    }

    const result = { ...summary, appliedThreads: applied.length, skippedConcurrentThreads: skippedConcurrent };
    await writePrivateJson(path.join(options.outputDir, "result.json"), result);
    console.log(JSON.stringify(result));
    if (skippedConcurrent.length) process.exitCode = 3;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
