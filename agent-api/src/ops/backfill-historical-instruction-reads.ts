import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

import { Prisma } from "@prisma/client";

import {
  buildHistoricalInstructionReadPatches,
  hasInstructionReadContentPart,
  HistoricalInstructionReadRolloutCollector,
  type HistoricalInstructionReadPatch,
  type HistoricalInstructionReadTurn,
  type HistoricalStoredMessage
} from "../codex-skills/historical-instruction-read-backfill.js";
import { appConfig } from "../config.js";
import { createDbClient } from "../db/client.js";

type CliOptions = {
  apply: boolean;
  root: string;
  report?: string;
  threadIds: Set<string>;
  from?: Date;
  to?: Date;
  limit?: number;
};

type BackfillSummary = {
  mode: "dry-run" | "apply";
  root: string;
  scannedRolloutFiles: number;
  invalidRolloutLines: number;
  turnsWithEvidence: number;
  threadsWithEvidence: number;
  candidateMessages: number;
  patchedMessages: number;
  skippedConcurrentMessages: number;
  alreadyMarkedMessages: number;
  ambiguousTurns: number;
  incompleteAssistantMessages: number;
  nonPortalAssistantMessages: number;
  turnsWithoutAssistant: number;
  missingDatabaseThreads: number;
};

function usage(): never {
  console.error([
    "Usage: node dist/ops/backfill-historical-instruction-reads.js [--dry-run|--apply] [options]",
    "",
    "Options:",
    "  --root <path>       CODEX_HOME root to scan (defaults to CODEX_SESSION_HOME_ROOT)",
    "  --thread-id <id>    Restrict to one Agent Studio thread; may be repeated",
    "  --from <ISO>        Include turns at or after this time",
    "  --to <ISO>          Include turns before this time",
    "  --limit <n>         Limit candidate messages after deterministic sorting",
    "  --report <path>     Write the summary and candidate audit rows as JSON",
    "",
    "Dry-run is the default. Apply mode updates only historical Portal assistant messages",
    "that lack codex_instruction_reads and uniquely match successful rollout evidence."
  ].join("\n"));
  process.exit(2);
}

function parsedDate(value: string | undefined): Date {
  const date = new Date(value ?? "");
  if (!value || !Number.isFinite(date.getTime())) usage();
  return date;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    root: appConfig.codex.sessionHomeRoot,
    threadIds: new Set()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) usage();
      options.root = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--thread-id") {
      const value = argv[index + 1]?.trim();
      if (!value) usage();
      options.threadIds.add(value);
      index += 1;
      continue;
    }
    if (arg === "--from") {
      options.from = parsedDate(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--to") {
      options.to = parsedDate(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) usage();
      options.limit = value;
      index += 1;
      continue;
    }
    if (arg === "--report") {
      const value = argv[index + 1];
      if (!value) usage();
      options.report = path.resolve(value);
      index += 1;
      continue;
    }
    usage();
  }
  if (options.from && options.to && options.from >= options.to) usage();
  return options;
}

async function collectRolloutFiles(root: string): Promise<string[]> {
  return await new Promise<string[]>((resolve, reject) => {
    const child = spawn("rg", [
      "-l",
      "-e",
      "SKILL\\.md",
      "-e",
      "<skill>",
      "-g",
      "rollout-*.jsonl",
      root
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`rollout evidence scan failed (${code}): ${stderr.trim()}`));
        return;
      }
      resolve(stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).sort());
    });
  });
}

async function parseRolloutFile(file: string): Promise<{ turns: HistoricalInstructionReadTurn[]; invalidLines: number }> {
  const collector = new HistoricalInstructionReadRolloutCollector(file);
  const lines = readline.createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY
  });
  for await (const line of lines) collector.pushLine(line);
  return collector.finish();
}

function mergeTurns(turns: HistoricalInstructionReadTurn[]): Map<string, HistoricalInstructionReadTurn[]> {
  const byTurn = new Map<string, HistoricalInstructionReadTurn>();
  for (const turn of turns) {
    const key = `${turn.threadId}\u0000${turn.turnId}`;
    const existing = byTurn.get(key);
    if (!existing) {
      byTurn.set(key, turn);
      continue;
    }
    const reads = new Map(existing.reads.map((read) => [`${read.kind}:${read.name.toLowerCase()}`, read]));
    for (const read of turn.reads) {
      const readKey = `${read.kind}:${read.name.toLowerCase()}`;
      const current = reads.get(readKey);
      if (!current || (current.trigger !== "selected" && read.trigger === "selected")) reads.set(readKey, read);
    }
    existing.reads = [...reads.values()];
    if (Date.parse(turn.startedAt) < Date.parse(existing.startedAt)) existing.startedAt = turn.startedAt;
  }

  const byThread = new Map<string, HistoricalInstructionReadTurn[]>();
  for (const turn of byTurn.values()) {
    const list = byThread.get(turn.threadId) ?? [];
    list.push(turn);
    byThread.set(turn.threadId, list);
  }
  for (const list of byThread.values()) {
    list.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  }
  return byThread;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function reportPatch(patch: HistoricalInstructionReadPatch) {
  return {
    threadId: patch.threadId,
    messageId: patch.messageId,
    turnId: patch.turnId,
    turnStartedAt: patch.turnStartedAt,
    sourceFile: patch.sourceFile,
    reads: patch.reads
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const files = await collectRolloutFiles(options.root);
  const rawTurns: HistoricalInstructionReadTurn[] = [];
  let invalidRolloutLines = 0;
  for (const file of files) {
    const parsed = await parseRolloutFile(file);
    invalidRolloutLines += parsed.invalidLines;
    rawTurns.push(...parsed.turns);
  }

  const filteredTurns = rawTurns.filter((turn) => {
    if (options.threadIds.size > 0 && !options.threadIds.has(turn.threadId)) return false;
    const startedAt = new Date(turn.startedAt);
    if (options.from && startedAt < options.from) return false;
    if (options.to && startedAt >= options.to) return false;
    return true;
  });
  const turnsByThread = mergeTurns(filteredTurns);
  const threadIds = [...turnsByThread.keys()].sort();
  const db = createDbClient();
  const patches: HistoricalInstructionReadPatch[] = [];
  const summary: BackfillSummary = {
    mode: options.apply ? "apply" : "dry-run",
    root: options.root,
    scannedRolloutFiles: files.length,
    invalidRolloutLines,
    turnsWithEvidence: [...turnsByThread.values()].reduce((total, turns) => total + turns.length, 0),
    threadsWithEvidence: turnsByThread.size,
    candidateMessages: 0,
    patchedMessages: 0,
    skippedConcurrentMessages: 0,
    alreadyMarkedMessages: 0,
    ambiguousTurns: 0,
    incompleteAssistantMessages: 0,
    nonPortalAssistantMessages: 0,
    turnsWithoutAssistant: 0,
    missingDatabaseThreads: 0
  };

  try {
    for (const threadIdBatch of chunks(threadIds, 100)) {
      const threads = await db.thread.findMany({
        where: { id: { in: threadIdBatch } },
        select: {
          id: true,
          messages: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              externalId: true,
              role: true,
              content: true,
              parentId: true,
              runConfig: true,
              position: true,
              createdAt: true
            }
          }
        }
      });
      summary.missingDatabaseThreads += threadIdBatch.length - threads.length;
      for (const thread of threads) {
        const matched = buildHistoricalInstructionReadPatches({
          threadId: thread.id,
          turns: turnsByThread.get(thread.id) ?? [],
          messages: thread.messages.map((message): HistoricalStoredMessage => ({
            ...message,
            role: String(message.role)
          }))
        });
        patches.push(...matched.patches);
        summary.alreadyMarkedMessages += matched.stats.alreadyMarkedMessages;
        summary.ambiguousTurns += matched.stats.ambiguousTurns;
        summary.incompleteAssistantMessages += matched.stats.incompleteAssistantMessages;
        summary.nonPortalAssistantMessages += matched.stats.nonPortalAssistantMessages;
        summary.turnsWithoutAssistant += matched.stats.turnsWithoutAssistant;
      }
    }

    patches.sort((left, right) =>
      left.turnStartedAt.localeCompare(right.turnStartedAt) || left.messageId.localeCompare(right.messageId)
    );
    const selectedPatches = options.limit ? patches.slice(0, options.limit) : patches;
    summary.candidateMessages = selectedPatches.length;

    if (options.apply) {
      for (const batch of chunks(selectedPatches, 100)) {
        await db.$transaction(async (tx) => {
          for (const patch of batch) {
            const current = await tx.message.findUnique({ where: { id: patch.messageId }, select: { content: true } });
            if (!current || hasInstructionReadContentPart(current.content)) {
              summary.skippedConcurrentMessages += 1;
              continue;
            }
            const updated = await tx.$executeRaw(Prisma.sql`
              UPDATE "messages"
              SET "content" = ${JSON.stringify(patch.content)}::jsonb
              WHERE "id" = ${patch.messageId}
                AND "content"::text NOT LIKE '%codex_instruction_reads%'
            `);
            if (updated === 1) summary.patchedMessages += 1;
            else summary.skippedConcurrentMessages += 1;
          }
        });
      }
    }

    const output = {
      summary,
      candidates: selectedPatches.map(reportPatch)
    };
    if (options.report) {
      await fs.mkdir(path.dirname(options.report), { recursive: true });
      await fs.writeFile(options.report, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    }
    process.stdout.write(`${JSON.stringify({
      ...summary,
      report: options.report,
      sample: selectedPatches.slice(0, 10).map(reportPatch)
    }, null, 2)}\n`);
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
