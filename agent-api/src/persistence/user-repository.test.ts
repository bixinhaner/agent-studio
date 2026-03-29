import { describe, expect, it } from "vitest";

import { UserRepository } from "./user-repository.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type FakeUserRow = {
  id: string;
  externalId: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
  status: string | null;
  statusSource: string | null;
  syncState: string | null;
  manualDisabled: boolean;
  adminNote: string | null;
  lastSyncedAt: Date | null;
  dingtalkOpenId: string | null;
  dingtalkUserId: string | null;
  dingtalkCorpId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

class FakeUserDb {
  private counter = 0;

  constructor(readonly rows: FakeUserRow[] = []) {}

  readonly user = {
    count: async () => this.rows.length,
    findUnique: async ({ where }: { where: { id?: string; externalId?: string; email?: string } }) => {
      const row = this.rows.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.externalId) return item.externalId === where.externalId;
        if (where.email) return item.email === where.email;
        return false;
      });
      return row ? clone(row) : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeUserRow = {
        id: typeof data.id === "string" ? data.id : `user-${++this.counter}`,
        externalId: typeof data.externalId === "string" ? data.externalId : null,
        email: typeof data.email === "string" ? data.email : null,
        displayName: typeof data.displayName === "string" ? data.displayName : null,
        role: typeof data.role === "string" ? data.role : null,
        status: typeof data.status === "string" ? data.status : null,
        statusSource: typeof data.statusSource === "string" ? data.statusSource : null,
        syncState: typeof data.syncState === "string" ? data.syncState : null,
        manualDisabled: typeof data.manualDisabled === "boolean" ? data.manualDisabled : false,
        adminNote: typeof data.adminNote === "string" ? data.adminNote : null,
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        dingtalkOpenId: typeof data.dingtalkOpenId === "string" ? data.dingtalkOpenId : null,
        dingtalkUserId: typeof data.dingtalkUserId === "string" ? data.dingtalkUserId : null,
        dingtalkCorpId: typeof data.dingtalkCorpId === "string" ? data.dingtalkCorpId : null,
        createdAt: now,
        updatedAt: now
      };
      this.rows.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.rows.find((item) => item.id === where.id);
      if (!row) {
        throw new Error("user not found");
      }
      Object.assign(row, clone(data));
      row.updatedAt = new Date();
      return clone(row);
    }
  };
}

describe("UserRepository", () => {
  it("creates a new DingTalk-backed user instead of linking by email alone", async () => {
    const db = new FakeUserDb([
      {
        id: "local-user",
        externalId: null,
        email: "agent@example.com",
        displayName: "Local Agent",
        role: "employee",
        status: "active",
        statusSource: "sync",
        syncState: "active",
        manualDisabled: false,
        adminNote: null,
        lastSyncedAt: null,
        dingtalkOpenId: null,
        dingtalkUserId: null,
        dingtalkCorpId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      }
    ]);
    const repository = new UserRepository(db as never);

    const user = await repository.upsertFromDingTalk({
      unionId: "ding-union-1",
      openId: "ding-open-1",
      email: "agent@example.com",
      displayName: "Ding Agent"
    });

    expect(user.id).not.toBe("local-user");
    expect(db.rows).toHaveLength(2);
    expect(db.rows.find((item) => item.id === "local-user")?.externalId).toBeNull();
    expect(db.rows.find((item) => item.externalId === "ding-union-1")).toMatchObject({
      role: "employee",
      status: "active",
      statusSource: "sync",
      syncState: "active",
      manualDisabled: false,
      dingtalkOpenId: "ding-open-1"
    });
  });

  it("requires a stable DingTalk unionId for persisted login", async () => {
    const repository = new UserRepository(new FakeUserDb() as never);

    await expect(
      repository.upsertFromDingTalk({
        unionId: "",
        openId: "ding-open-1",
        email: "agent@example.com"
      })
    ).rejects.toThrow(/unionId/i);
  });

  it("updates local governance fields without overwriting synced profile fields", async () => {
    const db = new FakeUserDb([
      {
        id: "user-1",
        externalId: "ding-union-1",
        email: "agent@example.com",
        displayName: "Ding Agent",
        role: "employee",
        status: "active",
        statusSource: "sync",
        syncState: "active",
        manualDisabled: false,
        adminNote: null,
        lastSyncedAt: new Date("2026-03-29T00:00:00.000Z"),
        dingtalkOpenId: "ding-open-1",
        dingtalkUserId: "ding-user-1",
        dingtalkCorpId: "ding-corp-1",
        createdAt: new Date("2026-03-20T00:00:00.000Z"),
        updatedAt: new Date("2026-03-20T00:00:00.000Z")
      }
    ]);
    const repository = new UserRepository(db as never);

    const updated = await repository.updateLocalSettings({
      userId: "user-1",
      role: "admin",
      manualDisabled: true,
      adminNote: "Locked pending review"
    });

    expect(updated).toMatchObject({
      id: "user-1",
      displayName: "Ding Agent",
      role: "admin",
      status: "disabled"
    });
    expect(db.rows[0]).toMatchObject({
      displayName: "Ding Agent",
      role: "admin",
      manualDisabled: true,
      adminNote: "Locked pending review",
      status: "disabled",
      statusSource: "manual_disable",
      syncState: "active"
    });
  });

  it("re-enables a manually disabled user based on the persisted sync state", async () => {
    const db = new FakeUserDb([
      {
        id: "user-1",
        externalId: "ding-union-1",
        email: "agent@example.com",
        displayName: "Ding Agent",
        role: "admin",
        status: "disabled",
        statusSource: "manual_disable",
        syncState: "departed",
        manualDisabled: true,
        adminNote: "Disabled locally",
        lastSyncedAt: new Date("2026-03-29T00:00:00.000Z"),
        dingtalkOpenId: "ding-open-1",
        dingtalkUserId: "ding-user-1",
        dingtalkCorpId: "ding-corp-1",
        createdAt: new Date("2026-03-20T00:00:00.000Z"),
        updatedAt: new Date("2026-03-20T00:00:00.000Z")
      }
    ]);
    const repository = new UserRepository(db as never);

    const updated = await repository.updateLocalSettings({
      userId: "user-1",
      role: "employee",
      manualDisabled: false,
      adminNote: null
    });

    expect(updated).toMatchObject({
      id: "user-1",
      displayName: "Ding Agent",
      role: "employee",
      status: "disabled"
    });
    expect(db.rows[0]).toMatchObject({
      role: "employee",
      manualDisabled: false,
      adminNote: null,
      status: "disabled",
      statusSource: "sync",
      syncState: "departed"
    });
  });
});
