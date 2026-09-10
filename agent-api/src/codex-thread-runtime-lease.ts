import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";

import { getDbEnv } from "./db/env.js";

const LOCK_NAMESPACE = "agent-studio:codex-thread-lock";
const ACQUIRE_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 250;

let pool: Pool | undefined;
const leaseContext = new AsyncLocalStorage<ReadonlySet<string>>();

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDbEnv().databaseUrl,
      max: 4,
      idleTimeoutMillis: 30_000
    });
  }
  return pool;
}

function lockKey(threadId: string): string {
  return `agent-studio:codex-thread:${threadId}`;
}

async function acquire(client: PoolClient, key: string): Promise<void> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (true) {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [`${LOCK_NAMESPACE}:${key}`]
    );
    if (result.rows[0]?.acquired) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out acquiring Codex thread runtime lease after ${ACQUIRE_TIMEOUT_MS}ms`);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, RETRY_DELAY_MS);
      timer.unref();
    });
  }
}

export async function withCodexThreadRuntimeLease<T>(threadId: string, action: () => Promise<T>): Promise<T> {
  const key = lockKey(threadId);
  const inheritedLeases = leaseContext.getStore();
  if (inheritedLeases?.has(key)) return await action();
  const client = await getPool().connect();
  try {
    await acquire(client, key);
  } catch (error) {
    client.release();
    throw error;
  }
  const activeLeases = new Set(inheritedLeases);
  activeLeases.add(key);
  try {
    return await leaseContext.run(activeLeases, action);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`${LOCK_NAMESPACE}:${key}`]).catch(() => undefined);
    client.release();
  }
}

export async function closeCodexThreadRuntimeLeasePool(): Promise<void> {
  const current = pool;
  pool = undefined;
  if (current) await current.end();
}
