import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createPermissionGuard } from "../auth/permission-guard.js";
import { AdminAuditLogRepository } from "../persistence/admin-audit-log-repository.js";
import { PermissionRepository } from "../persistence/permission-repository.js";
import {
  FakeRbacDb,
  type FakeAdminAuditLogRow,
  type FakePermissionRow,
  type FakeRolePermissionRow,
  type FakeRoleRow,
  type FakeUserRoleRow
} from "../persistence/rbac-test-helpers.js";
import { ResourcePolicyRepository } from "../persistence/resource-policy-repository.js";
import { RolePermissionRepository } from "../persistence/role-permission-repository.js";
import { RoleRepository } from "../persistence/role-repository.js";
import { UserRoleRepository } from "../persistence/user-role-repository.js";
import { PermissionService } from "../rbac/permission-service.js";
import { PolicyService } from "../resources/policy-service.js";
import { createRbacRouter } from "./rbac-router.js";

type FakePolicyRow = {
  id: string;
  organizationId: string | null;
  subjectType: "role" | "department" | "user";
  subjectId: string;
  resourceType: "workspace" | "knowledge_set" | "agent_mode" | "skill_package" | "run_profile";
  resourceId: string;
  effect: "allow" | "deny";
  createdAt: Date;
  updatedAt: Date;
};

class FakePolicyDb {
  constructor(readonly rows: FakePolicyRow[] = []) {}

  readonly resourcePolicy = {
    findMany: async ({
      where,
      orderBy
    }: {
      where?: { resourceType?: FakePolicyRow["resourceType"]; OR?: Array<{ subjectType: FakePolicyRow["subjectType"]; subjectId: string }> };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.rows.filter((item) => {
        if (where?.resourceType && item.resourceType !== where.resourceType) return false;
        if (where?.OR?.length) {
          return where.OR.some((subject) => item.subjectType === subject.subjectType && item.subjectId === subject.subjectId);
        }
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return structuredClone(rows);
    },
    deleteMany: async ({
      where
    }: {
      where: { resourceType?: FakePolicyRow["resourceType"]; OR?: Array<{ subjectType: FakePolicyRow["subjectType"]; subjectId: string }> };
    }) => {
      const before = this.rows.length;
      this.rows.splice(
        0,
        this.rows.length,
        ...this.rows.filter((item) => {
          if (where.resourceType && item.resourceType !== where.resourceType) return true;
          if (!where.OR?.length) return false;
          return !where.OR.some((subject) => item.subjectType === subject.subjectType && item.subjectId === subject.subjectId);
        })
      );
      return { count: before - this.rows.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakePolicyRow = {
        id: typeof data.id === "string" ? data.id : `policy-${this.rows.length + 1}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        subjectType: (data.subjectType as FakePolicyRow["subjectType"]) ?? "role",
        subjectId: String(data.subjectId ?? ""),
        resourceType: (data.resourceType as FakePolicyRow["resourceType"]) ?? "workspace",
        resourceId: String(data.resourceId ?? ""),
        effect: data.effect === "deny" ? "deny" : "allow",
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date(),
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : new Date()
      };
      this.rows.push(row);
      return structuredClone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakePolicyDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

function makeDate(value: string): Date {
  return new Date(value);
}

function buildRbacApp(seed?: {
  users?: ConstructorParameters<typeof FakeRbacDb>[0];
  roles?: FakeRoleRow[];
  permissions?: FakePermissionRow[];
  userRoles?: FakeUserRoleRow[];
  rolePermissions?: FakeRolePermissionRow[];
  auditLogs?: FakeAdminAuditLogRow[];
  policies?: FakePolicyRow[];
}) {
  const db = new FakeRbacDb(
    seed?.users ?? [
      {
        id: "admin-user",
        externalId: null,
        email: "admin@example.com",
        displayName: "Admin",
        role: "admin",
        status: "active",
        statusSource: "sync",
        syncState: "active",
        manualDisabled: false,
        adminNote: null,
        lastSyncedAt: null,
        dingtalkOpenId: null,
        dingtalkUserId: null,
        dingtalkCorpId: null,
        createdAt: makeDate("2026-03-29T00:00:00.000Z"),
        updatedAt: makeDate("2026-03-29T00:00:00.000Z")
      },
      {
        id: "user-1",
        externalId: null,
        email: "user@example.com",
        displayName: "User",
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
        createdAt: makeDate("2026-03-29T00:00:00.000Z"),
        updatedAt: makeDate("2026-03-29T00:00:00.000Z")
      }
    ],
    seed?.roles ?? [
      { id: "role-admin", organizationId: null, slug: "admin", name: "Admin", description: null, isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "role-employee", organizationId: null, slug: "employee", name: "Employee", description: null, isSystem: false, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "role-ops", organizationId: null, slug: "ops_manager", name: "Ops Manager", description: null, isSystem: false, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") }
    ],
    seed?.permissions ?? [
      { id: "permission-role-read", key: "role.read", name: "Read roles", description: null, category: "role", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-role-write", key: "role.write", name: "Write roles", description: null, category: "role", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-role-clone", key: "role.clone", name: "Clone roles", description: null, category: "role", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-role-disable", key: "role.disable", name: "Disable roles", description: null, category: "role", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-read", key: "permission.read", name: "Read permissions", description: null, category: "role", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-assign", key: "permission.assign", name: "Assign permissions", description: null, category: "role", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-policy-read", key: "resource_policy.read", name: "Read policies", description: null, category: "resource", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-policy-write", key: "resource_policy.write", name: "Write policies", description: null, category: "resource", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-user-read", key: "user.read", name: "Read users", description: null, category: "user", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-user-role-assign", key: "user.role.assign", name: "Assign user roles", description: null, category: "user", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "permission-audit-read", key: "audit.read", name: "Read audit", description: null, category: "audit", isSystem: true, isActive: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") }
    ],
    seed?.userRoles ?? [
      { id: "user-role-admin", userId: "admin-user", roleId: "role-admin", isPrimary: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") },
      { id: "user-role-employee", userId: "user-1", roleId: "role-employee", isPrimary: true, createdAt: makeDate("2026-03-29T00:00:00.000Z"), updatedAt: makeDate("2026-03-29T00:00:00.000Z") }
    ],
    seed?.rolePermissions ?? [],
    seed?.auditLogs ?? []
  );

  if (!seed?.rolePermissions) {
    const permissionIds = db.permissions.map((item) => item.id);
    db.rolePermissions.push(
      ...permissionIds.map((permissionId, index) => ({
        id: `role-permission-${index + 1}`,
        roleId: "role-admin",
        permissionId,
        createdAt: makeDate("2026-03-29T00:00:00.000Z"),
        updatedAt: makeDate("2026-03-29T00:00:00.000Z")
      }))
    );
  }

  const policyDb = new FakePolicyDb(
    seed?.policies ?? [
      {
        id: "user-policy-1",
        organizationId: null,
        subjectType: "user",
        subjectId: "user-1",
        resourceType: "workspace",
        resourceId: "workspace-user",
        effect: "allow",
        createdAt: makeDate("2026-03-29T00:00:00.000Z"),
        updatedAt: makeDate("2026-03-29T00:00:00.000Z")
      }
    ]
  );
  const roles = new RoleRepository(db as never);
  const permissions = new PermissionRepository(db as never);
  const userRoles = new UserRoleRepository(db as never);
  const rolePermissions = new RolePermissionRepository(db as never);
  const audits = new AdminAuditLogRepository(db as never);
  const policies = new PolicyService(new ResourcePolicyRepository(policyDb as never));
  const permissionService = new PermissionService({
    roles,
    userRoles,
    rolePermissions
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = {
      id: "admin-user",
      role: "admin",
      status: "active",
      createdAt: makeDate("2026-03-29T00:00:00.000Z").toISOString(),
      updatedAt: makeDate("2026-03-29T00:00:00.000Z").toISOString()
    };
    next();
  });
  app.use(
    "/api/admin",
    createRbacRouter({
      roles,
      permissions,
      userRoles,
      rolePermissions,
      audits,
      policies,
      requirePermission: createPermissionGuard(permissionService),
      db: db as never
    })
  );

  return { app, db, policyDb };
}

describe("createRbacRouter", () => {
  it("creates a custom role and records an audit log", async () => {
    const { app, db } = buildRbacApp();

    const response = await request(app).post("/api/admin/roles").send({
      slug: "ops_manager_2",
      name: "Ops Manager 2",
      description: "Operations managers"
    });

    expect(response.status).toBe(201);
    expect(response.body.role).toEqual(
      expect.objectContaining({
        slug: "ops_manager_2",
        name: "Ops Manager 2"
      })
    );
    expect(db.adminAuditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "role.created",
          targetType: "role"
        })
      ])
    );
  });

  it("replaces user roles with one primary role", async () => {
    const { app } = buildRbacApp();

    const response = await request(app).put("/api/admin/users/user-1/roles").send({
      assignments: [
        { roleId: "role-employee", isPrimary: false },
        { roleId: "role-admin", isPrimary: true }
      ]
    });

    expect(response.status).toBe(200);
    expect(response.body.userRoles).toEqual([
      expect.objectContaining({ roleId: "role-employee", isPrimary: false }),
      expect.objectContaining({ roleId: "role-admin", isPrimary: true })
    ]);
  });

  it("updates role-scoped resource policies without touching other subjects", async () => {
    const { app, policyDb } = buildRbacApp({
      policies: [
        {
          id: "policy-role-legacy",
          organizationId: null,
          subjectType: "role",
          subjectId: "role-ops",
          resourceType: "workspace",
          resourceId: "workspace-old",
          effect: "allow",
          createdAt: makeDate("2026-03-29T00:00:00.000Z"),
          updatedAt: makeDate("2026-03-29T00:00:00.000Z")
        },
        {
          id: "policy-user-keep",
          organizationId: null,
          subjectType: "user",
          subjectId: "user-1",
          resourceType: "workspace",
          resourceId: "workspace-user",
          effect: "allow",
          createdAt: makeDate("2026-03-29T00:00:00.000Z"),
          updatedAt: makeDate("2026-03-29T00:00:00.000Z")
        }
      ]
    });

    const response = await request(app).put("/api/admin/roles/role-ops/resource-policies").send({
      resourceType: "workspace",
      policies: [{ resourceId: "workspace-rd", effect: "allow" }]
    });

    expect(response.status).toBe(200);
    expect(policyDb.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectType: "role",
          subjectId: "role-ops",
          resourceId: "workspace-rd"
        }),
        expect.objectContaining({
          subjectType: "user",
          subjectId: "user-1",
          resourceId: "workspace-user"
        })
      ])
    );
    expect(policyDb.rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectType: "role",
          subjectId: "role-ops",
          resourceId: "workspace-old"
        })
      ])
    );
  });
});
