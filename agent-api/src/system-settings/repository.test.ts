import { describe, expect, it } from "vitest";

import { SystemSettingsRepository } from "./repository.js";
import { createDefaultSystemSettingsPayload } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createUniqueConstraintError(target: string): Error & { code: string } {
  const error = new Error(`unique constraint failed on ${target}`) as Error & { code: string };
  error.code = "P2002";
  return error;
}

function createBarrier(expectedCount = 1) {
  let enteredCount = 0;
  let released = false;
  let enteredResolve!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredResolve = resolve;
  });
  let releaseResolve!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });

  return {
    async wait(): Promise<void> {
      enteredCount += 1;
      if (enteredCount === expectedCount) {
        enteredResolve();
      }
      if (!released) {
        await release;
      }
    },
    whenEntered(): Promise<void> {
      return entered;
    },
    open(): void {
      if (!released) {
        released = true;
        releaseResolve();
      }
    }
  };
}

type FakeSystemSettingsVersionRow = {
  id: string;
  versionNumber: number;
  revision: number;
  status: "draft" | "published";
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  publishedByUserId: string | null;
};

class FakeSystemSettingsDb {
  private counter = 0;
  private delayedUpdateBarrier?: ReturnType<typeof createBarrier>;
  private delayedUpdatePredicate?: (data: Record<string, unknown>) => boolean;
  private delayedUpdateConsumed = false;
  private delayedCreateBarrier?: ReturnType<typeof createBarrier>;
  private delayedCreatePredicate?: (data: Record<string, unknown>) => boolean;
  private delayedCreateConsumed = false;
  private createFailurePredicate?: (data: Record<string, unknown>) => boolean;
  private createFailureError?: Error;
  private remainingCreateFailures = 0;
  private draftLookupBarrier?: ReturnType<typeof createBarrier>;
  private versionLookupBarrier?: ReturnType<typeof createBarrier>;
  private transactionCounter = 0;
  private rowLockOwnerById = new Map<string, number>();
  private rowLockWaitersById = new Map<string, Array<() => void>>();

  readonly rows: FakeSystemSettingsVersionRow[] = [];

  setDraftLookupBarrier(barrier: ReturnType<typeof createBarrier>): void {
    this.draftLookupBarrier = barrier;
  }

  setVersionLookupBarrier(barrier: ReturnType<typeof createBarrier>): void {
    this.versionLookupBarrier = barrier;
  }

  setDelayedCreateBarrier(
    barrier: ReturnType<typeof createBarrier>,
    predicate: (data: Record<string, unknown>) => boolean
  ): void {
    this.delayedCreateBarrier = barrier;
    this.delayedCreatePredicate = predicate;
    this.delayedCreateConsumed = false;
  }

  failNextCreates(count: number, predicate: (data: Record<string, unknown>) => boolean, error: Error): void {
    this.remainingCreateFailures = count;
    this.createFailurePredicate = predicate;
    this.createFailureError = error;
  }

  setDelayedUpdateBarrier(
    barrier: ReturnType<typeof createBarrier>,
    predicate: (data: Record<string, unknown>) => boolean
  ): void {
    this.delayedUpdateBarrier = barrier;
    this.delayedUpdatePredicate = predicate;
    this.delayedUpdateConsumed = false;
  }

  private async maybeDelayCreate(data: Record<string, unknown>): Promise<void> {
    if (this.delayedCreateConsumed) return;
    if (!this.delayedCreateBarrier || !this.delayedCreatePredicate || !this.delayedCreatePredicate(data)) return;
    this.delayedCreateConsumed = true;
    await this.delayedCreateBarrier.wait();
  }

  private async maybeDelayUpdate(data: Record<string, unknown>): Promise<void> {
    if (this.delayedUpdateConsumed) return;
    if (!this.delayedUpdateBarrier || !this.delayedUpdatePredicate || !this.delayedUpdatePredicate(data)) return;
    this.delayedUpdateConsumed = true;
    await this.delayedUpdateBarrier.wait();
  }

  private async acquireRowLock(rowId: string, transactionId?: number): Promise<boolean> {
    if (!transactionId) {
      return false;
    }
    while (true) {
      const owner = this.rowLockOwnerById.get(rowId);
      if (owner === undefined) {
        this.rowLockOwnerById.set(rowId, transactionId);
        return true;
      }
      if (owner === transactionId) {
        return false;
      }
      await new Promise<void>((resolve) => {
        const waiters = this.rowLockWaitersById.get(rowId) ?? [];
        waiters.push(resolve);
        this.rowLockWaitersById.set(rowId, waiters);
      });
    }
  }

  private releaseRowLock(rowId: string, transactionId: number): void {
    if (this.rowLockOwnerById.get(rowId) !== transactionId) {
      return;
    }
    this.rowLockOwnerById.delete(rowId);
    const waiters = this.rowLockWaitersById.get(rowId) ?? [];
    const next = waiters.shift();
    if (waiters.length > 0) {
      this.rowLockWaitersById.set(rowId, waiters);
    } else {
      this.rowLockWaitersById.delete(rowId);
    }
    next?.();
  }

  private applyRowUpdate(row: FakeSystemSettingsVersionRow, data: Record<string, unknown>): FakeSystemSettingsVersionRow {
    if ("versionNumber" in data && typeof data.versionNumber === "number") {
      row.versionNumber = data.versionNumber;
    }
    if ("revision" in data && typeof data.revision === "number") {
      row.revision = data.revision;
    }
    if ("status" in data && (data.status === "draft" || data.status === "published")) {
      row.status = data.status;
    }
    if ("payload" in data) {
      row.payload = clone(data.payload);
    }
    if ("publishedAt" in data) {
      row.publishedAt = data.publishedAt instanceof Date ? data.publishedAt : null;
    }
    if ("publishedByUserId" in data) {
      row.publishedByUserId = typeof data.publishedByUserId === "string" ? data.publishedByUserId : null;
    }
    row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
    return row;
  }

  private createSystemSettingsVersionTable(transactionId?: number) {
    return {
    findMany: async ({
      where,
      orderBy,
      take
    }: {
      where?: { status?: "draft" | "published"; id?: string };
      orderBy?: { versionNumber?: "asc" | "desc"; createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
      take?: number;
    } = {}) => {
      if (where?.status === "draft" && this.draftLookupBarrier) {
        await this.draftLookupBarrier.wait();
      }
      if (!where?.status && orderBy?.versionNumber && this.versionLookupBarrier) {
        await this.versionLookupBarrier.wait();
      }

      const rows = this.rows.filter((row) => {
        if (where?.status && row.status !== where.status) return false;
        if (where?.id && row.id !== where.id) return false;
        return true;
      });
      const [field, direction] = orderBy?.versionNumber
        ? (["versionNumber", orderBy.versionNumber] as const)
        : orderBy?.updatedAt
          ? (["updatedAt", orderBy.updatedAt] as const)
          : (["createdAt", orderBy?.createdAt ?? "asc"] as const);
      rows.sort((left, right) => {
        const leftValue =
          field === "versionNumber"
            ? left.versionNumber
            : field === "updatedAt"
              ? left.updatedAt.getTime()
              : left.createdAt.getTime();
        const rightValue =
          field === "versionNumber"
            ? right.versionNumber
            : field === "updatedAt"
              ? right.updatedAt.getTime()
              : right.createdAt.getTime();
        const diff = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
        return direction === "asc" ? diff : -diff;
      });
      return clone(typeof take === "number" ? rows.slice(0, take) : rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      await this.maybeDelayCreate(data);
      if (
        this.remainingCreateFailures > 0 &&
        this.createFailurePredicate?.(data) &&
        this.createFailureError
      ) {
        this.remainingCreateFailures -= 1;
        throw this.createFailureError;
      }
      const versionNumber = typeof data.versionNumber === "number" ? data.versionNumber : ++this.counter;
      const status = data.status === "published" || data.status === "draft" ? data.status : "draft";

      if (this.rows.some((row) => row.versionNumber === versionNumber)) {
        throw createUniqueConstraintError("system_settings_versions.version_number");
      }
      if (status === "draft" && this.rows.some((row) => row.status === "draft")) {
        throw createUniqueConstraintError("system_settings_versions.status");
      }

      const now = new Date();
      const row: FakeSystemSettingsVersionRow = {
        id: typeof data.id === "string" ? data.id : `system-settings-version-${++this.counter}`,
        versionNumber,
        revision: typeof data.revision === "number" ? data.revision : 0,
        status,
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
      await this.maybeDelayUpdate(data);
      this.applyRowUpdate(row, data);
      return clone(row);
    },
    updateMany: async ({
      where,
      data
    }: {
      where: { id: string; revision?: number };
      data: Record<string, unknown>;
    }) => {
      const row = this.rows.find((item) => item.id === where.id);
      if (!row) return { count: 0 };
      const acquiredLock = await this.acquireRowLock(where.id, transactionId);
      await this.maybeDelayUpdate(data);
      if (where.revision !== undefined && row.revision !== where.revision) {
        if (acquiredLock && transactionId) {
          this.releaseRowLock(where.id, transactionId);
        }
        return { count: 0 };
      }
      this.applyRowUpdate(row, data);
      return { count: 1 };
    }
  };
  }

  systemSettingsVersion = this.createSystemSettingsVersionTable();

  async $transaction<T>(callback: (tx: FakeSystemSettingsDb) => Promise<T>): Promise<T> {
    const transactionId = ++this.transactionCounter;
    const lockedRowIds = new Set<string>();
    const tx = Object.create(this) as FakeSystemSettingsDb;
    tx.systemSettingsVersion = {
      ...this.createSystemSettingsVersionTable(transactionId),
      updateMany: async (args: { where: { id: string; revision?: number }; data: Record<string, unknown> }) => {
        const result = await this.createSystemSettingsVersionTable(transactionId).updateMany(args);
        if (result.count > 0) {
          lockedRowIds.add(args.where.id);
        }
        return result;
      }
    };

    try {
      return await callback(tx);
    } finally {
      for (const rowId of lockedRowIds) {
        this.releaseRowLock(rowId, transactionId);
      }
    }
  }
}

describe("SystemSettingsRepository", () => {
  it("merges overlapping draft saves without losing the earlier change", async () => {
    const db = new FakeSystemSettingsDb();
    const repository = new SystemSettingsRepository(db as never);
    const delayedUpdate = createBarrier();
    db.setDelayedUpdateBarrier(delayedUpdate, (data) => {
      const payload = data.payload as { branding?: { platformName?: string } } | undefined;
      return payload?.branding?.platformName === "Alpha";
    });

    const firstSave = repository.saveDraft({
      branding: {
        platformName: "Alpha"
      }
    });
    await delayedUpdate.whenEntered();

    const secondSave = repository.saveDraft({
      retention: {
        sessionDays: 45
      }
    });
    delayedUpdate.open();

    await firstSave;
    const secondResult = await secondSave;
    const draft = await repository.getOrCreateDraft();

    expect(secondResult.payload).toMatchObject({
      retention: {
        sessionDays: 45
      }
    });
    expect(draft.payload).toMatchObject({
      branding: {
        platformName: "Alpha"
      },
      retention: {
        sessionDays: 45
      }
    });
  });

  it("returns the same draft when first-access creation races", async () => {
    const db = new FakeSystemSettingsDb();
    const repository = new SystemSettingsRepository(db as never);
    const draftLookupBarrier = createBarrier(2);
    db.setDraftLookupBarrier(draftLookupBarrier);

    const firstDraft = repository.getOrCreateDraft();
    const secondDraft = repository.getOrCreateDraft();
    await draftLookupBarrier.whenEntered();
    draftLookupBarrier.open();

    const [left, right] = await Promise.all([firstDraft, secondDraft]);
    expect(left.id).toBe(right.id);
    expect(db.rows.filter((row) => row.status === "draft")).toHaveLength(1);
  });

  it("retries publish when the published insert hits a version-number conflict", async () => {
    const db = new FakeSystemSettingsDb();
    db.rows.push({
      id: "draft-1",
      versionNumber: 1,
      revision: 0,
      status: "draft",
      payload: createDefaultSystemSettingsPayload(),
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      updatedAt: new Date("2026-03-30T10:00:00.000Z"),
      publishedAt: null,
      publishedByUserId: null
    });

    const repository = new SystemSettingsRepository(db as never);
    db.failNextCreates(
      1,
      (data) => data.status === "published",
      createUniqueConstraintError("system_settings_versions.version_number")
    );

    const published = await repository.publishDraft({
      publishedByUserId: "admin-1"
    });

    expect(published.versionNumber).toBe(2);
    expect(published.revision).toBe(1);
    expect(db.rows.filter((row) => row.status === "published")).toHaveLength(1);
  });

  it("does not let publish finalize against a stale draft while a save is racing", async () => {
    const db = new FakeSystemSettingsDb();
    const repository = new SystemSettingsRepository(db as never);
    const publishCreateBarrier = createBarrier();
    const saveUpdateBarrier = createBarrier();

    db.setDelayedCreateBarrier(publishCreateBarrier, (data) => data.status === "published");
    db.setDelayedUpdateBarrier(saveUpdateBarrier, (data) => {
      const payload = data.payload as { branding?: { platformName?: string } } | undefined;
      return payload?.branding?.platformName === "Published After Save";
    });

    const publishPromise = repository.publishDraft({
      publishedByUserId: "admin-1"
    });
    await publishCreateBarrier.whenEntered();

    let saveReachedUpdate = false;
    const saveReachedUpdatePromise = saveUpdateBarrier.whenEntered().then(() => {
      saveReachedUpdate = true;
    });
    const savePromise = repository.saveDraft({
      branding: {
        platformName: "Published After Save"
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveReachedUpdate).toBe(false);

    publishCreateBarrier.open();
    await saveReachedUpdatePromise;
    saveUpdateBarrier.open();

    const [published, saved] = await Promise.all([publishPromise, savePromise]);

    expect(published.payload.branding.platformName).toBe("Agent Studio");
    expect(saved.payload.branding.platformName).toBe("Published After Save");
  });
});
