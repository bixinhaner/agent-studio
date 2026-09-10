import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakePg = vi.hoisted(() => ({
  connectCalls: 0,
  lockedKeys: new Set<string>()
}));

vi.mock("pg", () => ({
  Pool: class {
    async connect() {
      fakePg.connectCalls += 1;
      return {
        async query(sql: string, values: string[]) {
          const key = values[0] ?? "";
          if (sql.includes("pg_try_advisory_lock")) {
            if (fakePg.lockedKeys.has(key)) return { rows: [{ acquired: false }] };
            fakePg.lockedKeys.add(key);
            return { rows: [{ acquired: true }] };
          }
          if (sql.includes("pg_advisory_unlock")) {
            fakePg.lockedKeys.delete(key);
          }
          return { rows: [] };
        },
        release() {}
      };
    }

    async end() {}
  }
}));

import {
  closeCodexThreadRuntimeLeasePool,
  withCodexThreadRuntimeLease
} from "./codex-thread-runtime-lease.js";

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://lease-test";
});

afterEach(async () => {
  fakePg.connectCalls = 0;
  fakePg.lockedKeys.clear();
  await closeCodexThreadRuntimeLeasePool();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("Codex thread runtime lease", () => {
  it("reuses the connection for nested conversation and thread leases without releasing the outer lock", async () => {
    await withCodexThreadRuntimeLease("conversation", async () => {
      await expect(withCodexThreadRuntimeLease("thread", async () => {
        expect(fakePg.lockedKeys.size).toBe(2);
        throw new Error("interrupted turn");
      })).rejects.toThrow("interrupted turn");
      expect(fakePg.lockedKeys.size).toBe(1);
      expect(fakePg.connectCalls).toBe(1);
    });
    expect(fakePg.lockedKeys.size).toBe(0);
  });
  it("serializes concurrent requests in the same Node process", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstCanExit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const firstDidEnter = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });

    const first = withCodexThreadRuntimeLease("thread-1", async () => {
      order.push("first-enter");
      firstEntered();
      await firstCanExit;
      order.push("first-exit");
    });
    await firstDidEnter;

    const second = withCodexThreadRuntimeLease("thread-1", async () => {
      order.push("second-enter");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(order).toEqual(["first-enter"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-enter", "first-exit", "second-enter"]);
    expect(fakePg.connectCalls).toBe(2);
  });

  it("allows a nested call in the same async context without reacquiring", async () => {
    await withCodexThreadRuntimeLease("thread-1", async () => {
      await withCodexThreadRuntimeLease("thread-1", async () => undefined);
    });
    expect(fakePg.connectCalls).toBe(1);
  });
});
