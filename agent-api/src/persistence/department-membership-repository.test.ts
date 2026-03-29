import { describe, expect, it } from "vitest";

import { DepartmentMembershipRepository } from "./department-membership-repository.js";

describe("DepartmentMembershipRepository", () => {
  it("prefers the primary department id when one exists", async () => {
    const repository = new DepartmentMembershipRepository({
      departmentMembership: {
        findMany: async () => [
          {
            id: "membership-1",
            userId: "user-1",
            departmentId: "dept-secondary",
            isPrimary: false,
            createdAt: new Date("2026-03-30T00:00:00Z")
          },
          {
            id: "membership-2",
            userId: "user-1",
            departmentId: "dept-primary",
            isPrimary: true,
            createdAt: new Date("2026-03-30T00:01:00Z")
          }
        ]
      },
      $transaction: async (callback) => callback({} as never)
    });

    await expect(repository.getPreferredDepartmentIdForUser("user-1")).resolves.toBe("dept-primary");
  });

  it("falls back to the first stable membership when no primary exists", async () => {
    const repository = new DepartmentMembershipRepository({
      departmentMembership: {
        findMany: async () => [
          {
            id: "membership-1",
            userId: "user-1",
            departmentId: "dept-a",
            isPrimary: false,
            createdAt: new Date("2026-03-30T00:00:00Z")
          },
          {
            id: "membership-2",
            userId: "user-1",
            departmentId: "dept-b",
            isPrimary: false,
            createdAt: new Date("2026-03-30T00:01:00Z")
          }
        ]
      },
      $transaction: async (callback) => callback({} as never)
    });

    await expect(repository.getPreferredDepartmentIdForUser("user-1")).resolves.toBe("dept-a");
  });
});
