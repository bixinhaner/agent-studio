import "dotenv/config";

import { PrismaClient } from "@prisma/client";

type Candidate = {
  threadId: string;
  runId: string;
  scenarioKey: string;
  runStatus: string;
  threadCreatedAt: Date;
};

const db = new PrismaClient();

async function findCandidates(): Promise<Candidate[]> {
  return await db.$queryRaw<Candidate[]>`
    SELECT DISTINCT ON (b.thread_id)
      b.thread_id AS "threadId",
      r.id AS "runId",
      r.scenario_key AS "scenarioKey",
      r.status AS "runStatus",
      t.created_at AS "threadCreatedAt"
    FROM external_conversation_bindings b
    JOIN threads t ON t.id = b.thread_id
    JOIN proactive_agent_runs r
      ON b.external_conversation_id = 'proactive-' || r.id
      OR b.external_conversation_id LIKE 'proactive-' || r.id || '-%'
    WHERE b.channel = 'action_connector'
      AND b.external_user_id = 'xomc-proactive-service'
      AND b.external_conversation_id LIKE 'proactive-%'
      AND t.status = 'active'
      AND r.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
    ORDER BY b.thread_id, r.completed_at DESC NULLS LAST, r.created_at DESC
  `;
}

async function main(): Promise<void> {
  const candidates = await findCandidates();
  const byScenario = new Map<string, number>();
  for (const candidate of candidates) byScenario.set(candidate.scenarioKey, (byScenario.get(candidate.scenarioKey) ?? 0) + 1);
  const sample = candidates.slice(0, 10).map((candidate) => ({
    ...candidate,
    threadCreatedAt: candidate.threadCreatedAt.toISOString()
  }));

  console.log(JSON.stringify({
    mode: process.argv.includes("--apply") ? "apply" : "dry-run",
    candidateCount: candidates.length,
    byScenario: Object.fromEntries(byScenario),
    sample
  }, null, 2));

  if (!process.argv.includes("--apply") || candidates.length === 0) return;
  const result = await db.$transaction(async (tx) => {
    let archived = 0;
    for (const candidate of candidates) {
      const updated = await tx.thread.updateMany({
        where: { id: candidate.threadId, status: "active" },
        data: { status: "archived" }
      });
      archived += updated.count;
    }
    return archived;
  });
  console.log(JSON.stringify({ mode: "applied", archivedCount: result }));
}

try {
  await main();
} finally {
  await db.$disconnect();
}
