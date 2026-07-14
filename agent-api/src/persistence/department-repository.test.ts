import { describe, expect, it, vi } from "vitest";

import { DepartmentRepository, type DepartmentRepositoryDb } from "./department-repository.js";

function departmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "department-1",
    organizationId: null,
    externalId: "dept-1",
    name: "Finance",
    parentDepartmentId: null,
    sortOrder: 1,
    status: "active",
    lastSyncedAt: null,
    createdAt: new Date("2026-07-14T00:00:00.000Z"),
    updatedAt: new Date("2026-07-14T00:00:00.000Z"),
    ...overrides
  };
}

describe("DepartmentRepository", () => {
  it("backfills the organization when updating a synced department", async () => {
    let row = departmentRow();
    const update = vi.fn(async (args: { data: Record<string, unknown> }) => {
      row = { ...row, ...args.data };
      return row;
    });
    const db = {
      department: {
        findUnique: vi.fn(async () => row),
        findMany: vi.fn(async () => [row]),
        create: vi.fn(async () => row),
        update
      },
      $transaction: async <T>(callback: (tx: DepartmentRepositoryDb) => Promise<T>) => callback(db as DepartmentRepositoryDb)
    };

    await new DepartmentRepository(db as DepartmentRepositoryDb).upsertMany([
      {
        organizationId: "org_internal",
        externalId: "dept-1",
        name: "Finance",
        sortOrder: 1,
        status: "active"
      }
    ]);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org_internal" })
      })
    );
    expect(row.organizationId).toBe("org_internal");
  });
});
