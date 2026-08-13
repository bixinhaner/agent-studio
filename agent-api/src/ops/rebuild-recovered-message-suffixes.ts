import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createDbClient } from "../db/client.js";
import {
  assertRecoveredMessageGraph,
  planMessageGraphRecovery,
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

function immutableSignature(messages: Array<RecoverableMessage & { content?: unknown; runConfig?: unknown }>): string {
  const normalized = [...messages]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((message) => ({
      id: message.id,
      externalId: message.externalId,
      role: message.role,
      content: message.content,
      runConfig: message.runConfig,
      createdAt: new Date(message.createdAt).toISOString(),
      updatedAt: message.updatedAt ? new Date(message.updatedAt).toISOString() : null
    }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
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
    return [{ entry, plan, signature: immutableSignature(entry.messages) }];
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
    const preview = baselines.map(({ entry, plan, signature }) => {
      const current = currentById.get(entry.thread.id);
      const currentByMessageId = new Map(current?.messages.map((message) => [message.id, message]) ?? []);
      return {
        threadId: entry.thread.id,
        reasons: plan.reasons,
        messages: plan.messages.length,
        visibleHeadDepthAfter: visibleHeadDepth(plan),
        changedParentsFromCurrent: plan.messages.filter((message) => currentByMessageId.get(message.id)?.parentId !== message.nextParentId).length,
        headBefore: current?.headId ?? null,
        headAfter: plan.headId,
        immutableSnapshotMatches: current ? immutableSignature(current.messages) === signature : false
      };
    });
    const summary = {
      mode: options.apply ? "apply" : "dry-run",
      topologyThreads: baselines.length,
      allMessagesVisibleAfter: preview.filter((item) => item.visibleHeadDepthAfter === item.messages).length,
      changedParents: preview.reduce((sum, item) => sum + item.changedParentsFromCurrent, 0),
      immutableSnapshotMismatches: preview.filter((item) => !item.immutableSnapshotMatches).map((item) => item.threadId),
      generatedAt: new Date().toISOString()
    };
    const applicableThreads = preview.filter((item) => item.immutableSnapshotMatches).length;
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
        if (summary.immutableSnapshotMismatches.includes(baseline.entry.thread.id)) {
          skippedConcurrent.push(baseline.entry.thread.id);
          continue;
        }
        const outcome = await db.$transaction(async (tx) => {
          await tx.$queryRawUnsafe(
            'SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
            `thread-messages:${baseline.entry.thread.id}`
          );
          const current = await tx.thread.findUnique({
            where: { id: baseline.entry.thread.id },
            include: { messages: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] } }
          });
          if (!current || immutableSignature(current.messages) !== baseline.signature) return false;
          for (const planned of baseline.plan.messages) {
            const stored = current.messages.find((message) => message.id === planned.id);
            if (!stored) return false;
            if (stored.parentId !== planned.nextParentId || stored.position !== planned.nextPosition) {
              await tx.message.update({
                where: { id: planned.id },
                data: { parentId: planned.nextParentId, position: planned.nextPosition, updatedAt: stored.updatedAt }
              });
            }
          }
          if (current.headId !== baseline.plan.headId) {
            await tx.thread.update({
              where: { id: current.id },
              data: { headId: baseline.plan.headId, updatedAt: current.updatedAt }
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
