import { describe, expect, it } from "vitest";

import type { PermissionDefinition, PermissionRecord } from "../persistence/permission-repository.js";
import type { RoleRecord } from "../persistence/role-repository.js";
import { BUILTIN_PERMISSION_DEFINITIONS, SeedSystemRbacService } from "./seed-system-rbac.js";

type FakeRoleRecord = RoleRecord;
type FakePermissionRecord = PermissionRecord;

class FakeRoleRepository {
  private counter = 0;

  constructor(readonly rows: FakeRoleRecord[] = []) {}

  async getBySlug(slug: string): Promise<FakeRoleRecord | undefined> {
    return this.rows.find((item) => item.slug === slug);
  }

  async create(input: {
    slug: string;
    name: string;
    description?: string;
    isSystem?: boolean;
    isActive?: boolean;
  }): Promise<FakeRoleRecord> {
    const now = new Date().toISOString();
    const record: FakeRoleRecord = {
      id: `role-${++this.counter}`,
      slug: input.slug,
      name: input.name,
      description: input.description,
      isSystem: input.isSystem ?? false,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now
    };
    this.rows.push(record);
    return record;
  }

  async update(roleId: string, input: { name?: string; description?: string; isSystem?: boolean; isActive?: boolean }) {
    const row = this.rows.find((item) => item.id === roleId);
    if (!row) {
      throw new Error("role 不存在");
    }
    Object.assign(row, input, { updatedAt: new Date().toISOString() });
    return row;
  }
}

class FakePermissionRepository {
  private counter = 0;

  constructor(readonly rows: FakePermissionRecord[] = []) {}

  async getByKey(key: string): Promise<FakePermissionRecord | null> {
    return this.rows.find((item) => item.key === key) ?? null;
  }

  async create(input: PermissionDefinition): Promise<FakePermissionRecord> {
    const now = new Date().toISOString();
    const record: FakePermissionRecord = {
      id: `permission-${++this.counter}`,
      key: input.key,
      name: input.name,
      description: input.description,
      category: input.category,
      isSystem: input.isSystem ?? true,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now
    };
    this.rows.push(record);
    return record;
  }

  async update(
    permissionId: string,
    input: { name?: string; description?: string; category?: string; isSystem?: boolean; isActive?: boolean }
  ) {
    const row = this.rows.find((item) => item.id === permissionId);
    if (!row) {
      throw new Error("permission 不存在");
    }
    Object.assign(row, input, { updatedAt: new Date().toISOString() });
    return row;
  }
}

class FakeRolePermissionRepository {
  readonly bindings = new Map<string, string[]>();

  async replaceRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
    this.bindings.set(roleId, [...permissionIds]);
  }
}

describe("SeedSystemRbacService", () => {
  it("creates system roles and built-in permissions idempotently", async () => {
    const roles = new FakeRoleRepository();
    const permissions = new FakePermissionRepository();
    const rolePermissions = new FakeRolePermissionRepository();
    const service = new SeedSystemRbacService({
      roles: roles as never,
      permissions: permissions as never,
      rolePermissions: rolePermissions as never
    });

    await service.run();
    await service.run();

    expect(roles.rows.map((item) => item.slug)).toEqual(["super_admin", "admin"]);
    expect(permissions.rows).toHaveLength(BUILTIN_PERMISSION_DEFINITIONS.length);
    expect(new Set(permissions.rows.map((item) => item.key))).toContain("role.write");
    expect(rolePermissions.bindings.size).toBe(2);
  });

  it("refreshes canonical permission bindings for both system roles", async () => {
    const roles = new FakeRoleRepository();
    const permissions = new FakePermissionRepository();
    const rolePermissions = new FakeRolePermissionRepository();
    const service = new SeedSystemRbacService({
      roles: roles as never,
      permissions: permissions as never,
      rolePermissions: rolePermissions as never
    });

    await service.run();

    const expectedPermissionCount = BUILTIN_PERMISSION_DEFINITIONS.length;
    for (const permissionIds of rolePermissions.bindings.values()) {
      expect(permissionIds).toHaveLength(expectedPermissionCount);
    }
  });
});
