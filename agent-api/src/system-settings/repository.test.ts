import { describe, expect, it } from "vitest";

import { SystemSettingsRepository } from "./repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeSystemSettingsVersionRow = {
  id: string;
  versionNumber: number;
  status: "draft" | "published";
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  publishedByUserId: string | null;
};

class FakeSystemSettingsDb {
  private counter = 0;

  readonly rows: FakeSystemSettingsVersionRow[] = [];

  readonly systemSettingsVersion = {
    findMany: async ({
      where,
      orderBy,
      take
    }: {
      where?: { status?: "draft" | "published"; id?: string };
      orderBy?: { versionNumber?: "asc" | "desc"; createdAt?: "asc" | "desc" };
      take?: number;
    } = {}) => {
      const rows = this.rows.filter((row) => {
        if (where?.status && row.status !== where.status) return false;
        if (where?.id && row.id !== where.id) return false;
        return true;
      });
      const [field, direction] = orderBy?.versionNumber
        ? (["versionNumber", orderBy.versionNumber] as const)
        : (["createdAt", orderBy?.createdAt ?? "asc"] as const);
      rows.sort((left, right) => {
        const leftValue = field === "versionNumber" ? left.versionNumber : left.createdAt.getTime();
        const rightValue = field === "versionNumber" ? right.versionNumber : right.createdAt.getTime();
        const diff = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
        return direction === "asc" ? diff : -diff;
      });
      return clone(typeof take === "number" ? rows.slice(0, take) : rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeSystemSettingsVersionRow = {
        id: typeof data.id === "string" ? data.id : `system-settings-version-${++this.counter}`,
        versionNumber: typeof data.versionNumber === "number" ? data.versionNumber : ++this.counter,
        status: data.status === "published" ? "published" : "draft",
        payload: clone(data.payload),
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now,
        publishedAt: data.publishedAt instanceof Date ? data.publishedAt : null,
        publishedByUserId: typeof data.publishedByUserId === "string" ? data.publishedByUserId : null
      };
      this.rows.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.rows.find((item) => item.id === where.id);
      if (!row) throw new Error("system settings version not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeSystemSettingsDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("SystemSettingsRepository", () => {
  it("creates a draft, preserves draft history on publish, and keeps prior versions unchanged", async () => {
    const db = new FakeSystemSettingsDb();
    const repository = new SystemSettingsRepository(db as never);

    const firstDraft = await repository.getOrCreateDraft();
    const updatedDraft = await repository.saveDraft({
      branding: {
        platformName: "Agent Studio"
      }
    });
    const published = await repository.publishDraft({
      publishedByUserId: "admin-1"
    });

    expect(firstDraft.status).toBe("draft");
    expect(updatedDraft.id).toBe(firstDraft.id);
    expect(updatedDraft.versionNumber).toBe(firstDraft.versionNumber);
    expect(updatedDraft.payload).toMatchObject({
      branding: {
        platformName: "Agent Studio",
        loginCopy: expect.any(String)
      }
    });
    expect(published.id).not.toBe(updatedDraft.id);
    expect(published.status).toBe("published");
    expect(published.versionNumber).toBe(updatedDraft.versionNumber + 1);
    expect(published.publishedByUserId).toBe("admin-1");
    expect(published.payload).toEqual(updatedDraft.payload);
    expect(db.rows.map((row) => ({ id: row.id, status: row.status }))).toEqual([
      { id: updatedDraft.id, status: "draft" },
      { id: published.id, status: "published" }
    ]);
  });
});
