import fs from "node:fs/promises";
import path from "node:path";

import { createDbClient } from "../db/client.js";
import {
  assertRecoveredMessageGraph,
  messageGraphSnapshotSignature,
  planMessageGraphRecovery,
  planMessageGraphSuffixRebuild,
  type RecoverableMessage
} from "../persistence/message-graph-recovery.js";

type Options = {
  apply: boolean;
  backup: string;
  outputDir: string;
  expectedThreads?: number;
  expectedApplicable?: number;
};

type BackupThread = {
  thread: { id: string; headId?: string | null };
  messages: Array<RecoverableMessage & { content?: unknown; runConfig?: unknown }>;
};

function usage(): never {
  console.error("Usage: tsx src/ops/rebuild-recovered-message-suffixes.ts --backup <before-state.json> --output-dir <path> [--dry-run|--apply] [--expected-threads <n>] [--expected-applicable <n>]");
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, backup: "", outputDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--backup") options.backup = path.resolve(argv[++index] ?? "");
    else if (arg === "--output-dir") options.outputDir = path.resolve(argv[++index] ?? "");
    else if (arg === "--expected-threads") {
      const value = Number.parseInt(argv[++index] ?? "", 10);
      if (!Number.isFinite(value) || value < 0) usage();
      options.expectedThreads = value;
    } else if (arg === "--expected-applicable") {
      const value = Number.parseInt(argv[++index] ?? "", 10);
      if (!Number.isFinite(value) || value < 0) usage();
      options.expectedApplicable = value;
    } else usage();
  }
  if (!options.backup || !options.outputDir) usage();
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

function visibleHeadDepth(plan: ReturnType<typeof planMessageGraphRecovery>): number {
  const parents = new Map(plan.messages
    .filter((message) => message.externalId)
    .map((message) => [message.externalId!, message.nextParentId]));
  const seen = new Set<string>();
  let cursor = plan.headId;
  while (cursor && parents.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return seen.size;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const backup = JSON.parse(await fs.readFile(options.backup, "utf8")) as { threads?: BackupThread[] };
  const baselines = (backup.threads ?? []).flatMap((entry) => {
    const plan = planMessageGraphRecovery({ messages: entry.messages, headId: entry.thread.headId });
    if (!plan.reasons.includes("missing_parent") && !plan.reasons.includes("cycle")) return [];
    assertRecoveredMessageGraph(plan);
    const repairStart = plan.messages.find((message) => message.parentId !== message.nextParentId)?.externalId;
    if (!repairStart) return [];
    return [{ entry, repairStart }];
  });
  if (options.expectedThreads !== undefined && options.expectedThreads !== baselines.length) {
    throw new Error(`Topology thread guard failed: expected ${options.expectedThreads}, found ${baselines.length}`);
  }

  const db = createDbClient();
  try {
    const currentThreads = await db.thread.findMany({
      where: { id: { in: baselines.map(({ entry }) => entry.thread.id) } },
      include: { messages: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] } }
    });
    const currentById = new Map(currentThreads.map((thread) => [thread.id, thread]));
    const signatures = new Map<string, string>();
    const plans = new Map<string, ReturnType<typeof planMessageGraphSuffixRebuild>>();
    const preview = baselines.map(({ entry, repairStart }) => {
      const current = currentById.get(entry.thread.id);
      if (!current) throw new Error(`Recovered thread no longer exists: ${entry.thread.id}`);
      const plan = planMessageGraphSuffixRebuild({
        messages: current.messages,
        headId: current.headId,
        startExternalId: repairStart!
      });
      assertRecoveredMessageGraph(plan);
      plans.set(entry.thread.id, plan);
      signatures.set(entry.thread.id, messageGraphSnapshotSignature(current.messages));
      const currentByMessageId = new Map(current?.messages.map((message) => [message.id, message]) ?? []);
      return {
        threadId: entry.thread.id,
        reasons: plan.reasons,
        messages: plan.messages.length,
        visibleHeadDepthAfter: visibleHeadDepth(plan),
        changedParentsFromCurrent: plan.messages.filter((message) => currentByMessageId.get(message.id)?.parentId !== message.nextParentId).length,
        headBefore: current?.headId ?? null,
        headAfter: plan.headId,
        currentSnapshotCaptured: true
      };
    });
    const summary = {
      mode: options.apply ? "apply" : "dry-run",
      topologyThreads: baselines.length,
      allMessagesVisibleAfter: preview.filter((item) => item.visibleHeadDepthAfter === item.messages).length,
      changedParents: preview.reduce((sum, item) => sum + item.changedParentsFromCurrent, 0),
      generatedAt: new Date().toISOString()
    };
    const applicableThreads = preview.length;
    if (options.expectedApplicable !== undefined && options.expectedApplicable !== applicableThreads) {
      throw new Error(`Applicable thread guard failed: expected ${options.expectedApplicable}, found ${applicableThreads}`);
    }
    await writePrivateJson(path.join(options.outputDir, "preview.json"), { summary, threads: preview });
    await writePrivateJson(path.join(options.outputDir, "before-suffix-rebuild.json"), {
      summary,
      threads: currentThreads
    });

    let applied = 0;
    const skippedConcurrent: string[] = [];
    if (options.apply) {
      for (const baseline of baselines) {
        const outcome = await db.$transaction(async (tx) => {
          await tx.$queryRawUnsafe(
            'SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
            `thread-messages:${baseline.entry.thread.id}`
          );
          const current = await tx.thread.findUnique({
            where: { id: baseline.entry.thread.id },
            include: { messages: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] } }
          });
          if (!current || messageGraphSnapshotSignature(current.messages) !== signatures.get(baseline.entry.thread.id)) return false;
          const plan = plans.get(baseline.entry.thread.id);
          if (!plan) return false;
          for (const planned of plan.messages) {
            const stored = current.messages.find((message) => message.id === planned.id);
            if (!stored) return false;
            if (stored.parentId !== planned.nextParentId || stored.position !== planned.nextPosition) {
              await tx.message.update({
                where: { id: planned.id },
                data: { parentId: planned.nextParentId, position: planned.nextPosition, updatedAt: stored.updatedAt }
              });
            }
          }
          if (current.headId !== plan.headId) {
            await tx.thread.update({
              where: { id: current.id },
              data: { headId: plan.headId, updatedAt: current.updatedAt }
            });
          }
          return true;
        });
        if (outcome) applied += 1;
        else skippedConcurrent.push(baseline.entry.thread.id);
      }
    }
    const result = { ...summary, appliedThreads: applied, skippedConcurrent };
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
