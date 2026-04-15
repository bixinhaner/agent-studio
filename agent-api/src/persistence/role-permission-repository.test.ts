import { describe, expect, it } from "vitest";

import { RolePermissionRepository } from "./role-permission-repository.js";

describe("RolePermissionRepository", () => {
  it("uses Prisma's in filter when loading permissions for multiple roles", async () => {
    const rolePermissionWhereInputs: unknown[] = [];
    const repository = new RolePermissionRepository({
      rolePermission: {
        async findMany(args) {
          rolePermissionWhereInputs.push(args?.where);
          return [
            {
              id: "binding-1",
              roleId: "role-a",
              permissionId: "permission-a",
              createdAt: "2026-04-15T00:00:00.000Z",
              updatedAt: "2026-04-15T00:00:00.000Z"
            }
          ];
        },
        async deleteMany() {
          return { count: 0 };
        }
      },
      permission: {
        async findMany() {
          return [{ id: "permission-a", key: "monitoring.read", isActive: true }];
        }
      }
    });

    await expect(repository.listPermissionKeysForRoleIds(["role-a", "role-b"])).resolves.toEqual(["monitoring.read"]);
    expect(rolePermissionWhereInputs[0]).toEqual({ roleId: { in: ["role-a", "role-b"] } });
  });
});
