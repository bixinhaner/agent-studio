import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";

import { createDbClient } from "../db/client.js";
import {
  planImageOnlyTailBackfill,
  recoveredImageAssistantMessage
} from "../portal/image-only-tail-backfill.js";

type CliOptions = {
  apply: boolean;
  threadId: string;
  after: Date;
  before?: Date;
  expectedTurns?: number;
  outputDir: string;
};

function usage(): never {
  console.error([
    "Usage: node dist/ops/backfill-image-only-tail.js --thread-id <id> --after <ISO> --output-dir <path> [options]",
    "",
    "Options:",
    "  --before <ISO>          Optional exclusive upper time bound",
    "  --expected-turns <n>    Refuse apply if the planned turn count differs",
    "  --dry-run               Preview only (default)",
    "  --apply                 Write the recovery after saving a private before-state snapshot",
    "",
    "The command only repairs a contiguous tail of user messages that has no assistant children",
    "and has one or more ready artifacts in every turn window."
  ].join("\n"));
  process.exit(2);
}

function parseDate(value: string | undefined): Date {
  const parsed = value ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime())) usage();
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let threadId = "";
  let after: Date | undefined;
  let before: Date | undefined;
  let expectedTurns: number | undefined;
  let outputDir = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--thread-id") {
      threadId = next?.trim() ?? "";
      index += 1;
    } else if (arg === "--after") {
      after = parseDate(next);
      index += 1;
    } else if (arg === "--before") {
      before = parseDate(next);
      index += 1;
    } else if (arg === "--expected-turns") {
      expectedTurns = Number.parseInt(next ?? "", 10);
      if (!Number.isInteger(expectedTurns) || expectedTurns < 0) usage();
      index += 1;
    } else if (arg === "--output-dir") {
      outputDir = next ? path.resolve(next) : "";
      index += 1;
    } else usage();
  }
  if (!threadId || !after || !outputDir || (before && before <= after)) usage();
  return { apply, threadId, after, before, expectedTurns, outputDir };
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

function snapshotSignature(value: unknown): string {
  return createHash("sha256").update(json(value)).digest("hex");
}

function planningInput(thread: {
  id: string;
  headId: string | null;
  messages: Array<{
    id: string;
    externalId: string | null;
    role: string;
    parentId: string | null;
    position: number;
    createdAt: Date;
    updatedAt: Date;
    content: unknown;
    runConfig: unknown;
  }>;
  artifacts: Array<{
    id: string;
    relativePath: string;
    previewStatus: string;
    downloadStatus: string;
    workspaceFileId: string | null;
    workspaceFileVersionId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}, options: CliOptions) {
  return {
    threadId: thread.id,
    headId: thread.headId,
    messages: thread.messages,
    artifacts: thread.artifacts,
    after: options.after,
    before: options.before
  };
}

function concurrencySnapshot(thread: Parameters<typeof planningInput>[0]): unknown {
  return {
    headId: thread.headId,
    messages: thread.messages.map((message) => ({
      id: message.id,
      externalId: message.externalId,
      parentId: message.parentId,
      position: message.position,
      updatedAt: message.updatedAt
    })),
    artifacts: thread.artifacts.map((artifact) => ({ id: artifact.id, updatedAt: artifact.updatedAt }))
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  try {
    const thread = await db.thread.findUnique({
      where: { id: options.threadId },
      include: {
        messages: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
        artifacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }
      }
    });
    if (!thread) throw new Error(`Thread not found: ${options.threadId}`);
    const plan = planImageOnlyTailBackfill(planningInput(thread, options));
    if (options.expectedTurns !== undefined && plan.turns.length !== options.expectedTurns) {
      throw new Error(`Turn-count guard failed: expected ${options.expectedTurns}, planned ${plan.turns.length}`);
    }
    const beforeState = {
      generatedAt: new Date().toISOString(),
      mode: options.apply ? "apply" : "dry-run",
      thread: {
        id: thread.id,
        title: thread.title,
        userId: thread.userId,
        channel: thread.channel,
        headId: thread.headId,
        messages: thread.messages,
        artifacts: thread.artifacts
      }
    };
    const preview = {
      mode: options.apply ? "apply" : "dry-run",
      threadId: thread.id,
      affected: plan.affected,
      plannedTurns: plan.turns.length,
      plannedArtifacts: plan.turns.reduce((sum, turn) => sum + turn.artifacts.length, 0),
      headBefore: plan.headBefore,
      headAfter: plan.headAfter,
      turns: plan.turns.map((turn) => ({
        userMessageId: turn.userMessage.externalId,
        userCreatedAt: turn.userMessage.createdAt,
        assistantId: turn.assistantId,
        completedAt: turn.completedAt,
        artifacts: turn.artifacts.map((artifact) => ({ id: artifact.id, path: artifact.relativePath }))
      }))
    };
    await writePrivateJson(path.join(options.outputDir, "before-state.json"), beforeState);
    await writePrivateJson(path.join(options.outputDir, "preview.json"), preview);

    if (options.apply && plan.affected) {
      const expectedSignature = snapshotSignature(concurrencySnapshot(thread));
      await db.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
          `thread-messages:${thread.id}`
        );
        const current = await tx.thread.findUnique({
          where: { id: thread.id },
          include: {
            messages: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
            artifacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }
          }
        });
        if (!current || snapshotSignature(concurrencySnapshot(current)) !== expectedSignature) {
          throw new Error("Thread changed after preview; refusing recovery");
        }

        await tx.$executeRawUnsafe(
          "UPDATE messages SET position = position + 1000000 WHERE thread_id = $1",
          thread.id
        );
        for (let index = 0; index < plan.prefixMessages.length; index += 1) {
          await tx.message.update({
            where: { id: plan.prefixMessages[index]!.id },
            data: { position: index }
          });
        }
        for (const turn of plan.turns) {
          await tx.message.update({
            where: { id: turn.userMessage.id },
            data: { parentId: turn.userParentId, position: turn.userPosition }
          });
          await tx.message.create({
            data: {
              threadId: thread.id,
              externalId: turn.assistantId,
              role: "assistant",
              content: recoveredImageAssistantMessage(turn) as Prisma.InputJsonValue,
              parentId: turn.userMessage.externalId,
              runConfig: {
                channel: "portal",
                serverPersisted: true,
                recovered: true,
                recoverySource: "image_only_artifact_backfill"
              },
              position: turn.assistantPosition,
              createdAt: turn.completedAt,
              updatedAt: turn.completedAt
            }
          });
        }
        await tx.thread.update({
          where: { id: thread.id },
          data: { headId: plan.headAfter, updatedAt: new Date() }
        });
      });
    }

    console.log(json(preview).trimEnd());
  } finally {
    await db.$disconnect();
  }
}

await main();
