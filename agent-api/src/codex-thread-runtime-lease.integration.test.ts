import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeCodexThreadRuntimeLeasePool, withCodexThreadRuntimeLease } from "./codex-thread-runtime-lease.js";

const url = process.env.ASSISTANT_TEST_DATABASE_URL;
const suite = url ? describe.sequential : describe.skip;
suite("persistent conversation leases (PostgreSQL)", () => {
  const original = process.env.DATABASE_URL;
  const observer = new Pool({ connectionString: url, max: 1 });
  beforeAll(() => { process.env.DATABASE_URL = url; });
  afterAll(async () => {
    await closeCodexThreadRuntimeLeasePool(); await observer.end();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
  });
  it("excludes another database session and releases after a failed turn", async () => {
    const id = `assistant-${randomUUID()}`;
    const key = `agent-studio:codex-thread-lock:agent-studio:codex-thread:${id}`;
    const client = await observer.connect();
    try {
      await expect(withCodexThreadRuntimeLease(id, async () => {
        const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [key]);
        expect(result.rows[0].acquired).toBe(false);
        throw new Error("interrupted turn");
      })).rejects.toThrow("interrupted turn");
      const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [key]);
      expect(result.rows[0].acquired).toBe(true);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]); client.release();
    }
  });
  it("restores four concurrent assistants without exhausting the four-connection lease pool", async () => {
    let entered = 0; let release!: () => void;
    const allEntered = new Promise<void>((resolve) => { release = resolve; });
    await Promise.all(Array.from({ length: 4 }, async () => {
      const id = randomUUID();
      await withCodexThreadRuntimeLease(`conversation-${id}`, async () => {
        if (++entered === 4) release();
        await allEntered;
        await withCodexThreadRuntimeLease(`thread-${id}`, async () => undefined);
      });
    }));
    expect(entered).toBe(4);
  }, 10000);
});
