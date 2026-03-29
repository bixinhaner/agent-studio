# Agent Studio RBAC Role And Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class RBAC roles, permissions, user-role assignment, unified role authorization management, and audit logs while preserving `resource_policies` as the resource-instance authorization layer.

**Architecture:** Extend the Prisma schema with roles, permissions, user-role bindings, role-permission bindings, and admin audit logs. Add repositories plus a permission-evaluation service and permission-based request guard, then build admin APIs and admin-console role-management views that edit both function permissions and role-scoped resource policies from one workflow. Preserve compatibility by mirroring the primary assigned role into the legacy `users.role` field and by keeping runtime resource authorization on top of the existing `resource_policies` engine.

**Tech Stack:** Prisma ORM, PostgreSQL, Express, TypeScript, React, Vite, assistant-ui, Vitest, Supertest.

---

## File Structure

### Backend

- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/20260329230000_add_rbac_roles_permissions/migration.sql`
- Create: `agent-api/src/persistence/role-repository.ts`
- Create: `agent-api/src/persistence/role-repository.test.ts`
- Create: `agent-api/src/persistence/permission-repository.ts`
- Create: `agent-api/src/persistence/permission-repository.test.ts`
- Create: `agent-api/src/persistence/user-role-repository.ts`
- Create: `agent-api/src/persistence/user-role-repository.test.ts`
- Create: `agent-api/src/persistence/role-permission-repository.ts`
- Create: `agent-api/src/persistence/role-permission-repository.test.ts`
- Create: `agent-api/src/persistence/admin-audit-log-repository.ts`
- Create: `agent-api/src/persistence/admin-audit-log-repository.test.ts`
- Create: `agent-api/src/auth/permission-guard.ts`
- Create: `agent-api/src/auth/permission-guard.test.ts`
- Create: `agent-api/src/rbac/permission-service.ts`
- Create: `agent-api/src/rbac/permission-service.test.ts`
- Create: `agent-api/src/rbac/seed-system-rbac.ts`
- Create: `agent-api/src/rbac/seed-system-rbac.test.ts`
- Create: `agent-api/src/admin/rbac-router.ts`
- Create: `agent-api/src/admin/rbac-router.test.ts`
- Modify: `agent-api/src/admin/router.ts`
- Modify: `agent-api/src/admin/router.test.ts`
- Modify: `agent-api/src/app-routes.ts`
- Modify: `agent-api/src/index.ts`
- Modify: `agent-api/src/resources/policy-service.ts`
- Modify: `agent-api/src/resources/policy-service.test.ts`
- Modify: `agent-api/src/persistence/user-repository.ts`
- Modify: `agent-api/src/persistence/user-repository.test.ts`

### Frontend

- Create: `agent-ui/src/features/rbac/types.ts`
- Create: `agent-ui/src/features/rbac/api.ts`
- Create: `agent-ui/src/features/rbac/RolesView.tsx`
- Create: `agent-ui/src/features/rbac/RolesView.test.tsx`
- Create: `agent-ui/src/features/rbac/RoleDetailView.tsx`
- Create: `agent-ui/src/features/rbac/RoleDetailView.test.tsx`
- Create: `agent-ui/src/features/rbac/UserRoleEditor.tsx`
- Create: `agent-ui/src/features/rbac/UserRoleEditor.test.tsx`
- Create: `agent-ui/src/features/rbac/PermissionMatrix.tsx`
- Create: `agent-ui/src/features/rbac/PermissionMatrix.test.tsx`
- Create: `agent-ui/src/features/rbac/RoleAuditView.tsx`
- Create: `agent-ui/src/features/rbac/RoleAuditView.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/features/admin/UsersView.tsx`
- Modify: `agent-ui/src/features/admin/UsersView.test.tsx`
- Modify: `agent-ui/src/styles.css`

### Docs

- Reference: `docs/superpowers/specs/2026-03-29-agent-studio-rbac-role-permission-design.md`

## Notes

- Keep `super_admin` and `admin` as system roles.
- Keep `resource_policies` as the existing resource-instance authorization source of truth.
- New function-level authorization should use `requirePermission(...)`; keep `super_admin` bypass semantics.
- Preserve `users.role` as a compatibility mirror of the primary assigned role in this phase.
- All RBAC writes must emit admin audit logs.

### Task 1: Extend Prisma schema for roles, permissions, user-role bindings, and admin audit logs

**Files:**
- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/20260329230000_add_rbac_roles_permissions/migration.sql`

- [ ] **Step 1: Run a failing schema diff check for the RBAC tables**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE "(roles|permissions|user_roles|role_permissions|admin_audit_logs)"'
```

Expected: FAIL because these tables do not yet exist in the schema.

- [ ] **Step 2: Add Prisma models for RBAC and audit storage**

Add models like:

```prisma
model Role {
  id             String           @id @default(cuid())
  organizationId String?          @map("organization_id")
  slug           String
  name           String
  description    String?
  isSystem       Boolean          @default(false) @map("is_system")
  isActive       Boolean          @default(true) @map("is_active")
  createdAt      DateTime         @default(now()) @map("created_at")
  updatedAt      DateTime         @updatedAt @map("updated_at")

  userRoles        UserRole[]
  rolePermissions  RolePermission[]

  @@unique([organizationId, slug])
  @@map("roles")
}

model Permission {
  id          String           @id @default(cuid())
  key         String           @unique
  name        String
  description String?
  category    String
  isSystem    Boolean          @default(true) @map("is_system")
  isActive    Boolean          @default(true) @map("is_active")
  createdAt   DateTime         @default(now()) @map("created_at")
  updatedAt   DateTime         @updatedAt @map("updated_at")

  rolePermissions RolePermission[]

  @@map("permissions")
}

model UserRole {
  id        String   @id @default(cuid())
  userId     String   @map("user_id")
  roleId     String   @map("role_id")
  isPrimary  Boolean  @default(false) @map("is_primary")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Restrict)

  @@unique([userId, roleId])
  @@index([userId, isPrimary])
  @@index([roleId])
  @@map("user_roles")
}

model RolePermission {
  id           String   @id @default(cuid())
  roleId       String   @map("role_id")
  permissionId String   @map("permission_id")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@unique([roleId, permissionId])
  @@index([permissionId])
  @@map("role_permissions")
}

model AdminAuditLog {
  id             String   @id @default(cuid())
  organizationId String?  @map("organization_id")
  actorUserId     String?  @map("actor_user_id")
  actionType      String   @map("action_type")
  targetType      String   @map("target_type")
  targetId        String?  @map("target_id")
  beforePayload   Json?    @map("before_payload")
  afterPayload    Json?    @map("after_payload")
  metadata        Json?
  createdAt       DateTime @default(now()) @map("created_at")

  actorUser User? @relation(fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([actorUserId, createdAt])
  @@index([targetType, targetId, createdAt])
  @@map("admin_audit_logs")
}
```

Extend `User` with:

```prisma
userRoles       UserRole[]
auditLogEntries AdminAuditLog[] @relation("AdminAuditActor")
```

and update the `AdminAuditLog.actorUser` relation name to match.

- [ ] **Step 3: Add the SQL migration**

Create `agent-api/prisma/migrations/20260329230000_add_rbac_roles_permissions/migration.sql` with concrete DDL for the five new tables, all indexes, and all foreign keys. Do not drop or rewrite existing `users.role`; leave it in place for compatibility.

- [ ] **Step 4: Run Prisma generation and verify the new table diff**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm run prisma:generate
npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE "(roles|permissions|user_roles|role_permissions|admin_audit_logs)"'
```

Expected: PASS with the new table names present.

- [ ] **Step 5: Commit the schema work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/schema.prisma /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/migrations/20260329230000_add_rbac_roles_permissions
git commit -m "feat: add rbac schema models"
```

### Task 2: Add RBAC repositories and seed logic for system roles and permissions

**Files:**
- Create: `agent-api/src/persistence/role-repository.ts`
- Create: `agent-api/src/persistence/role-repository.test.ts`
- Create: `agent-api/src/persistence/permission-repository.ts`
- Create: `agent-api/src/persistence/permission-repository.test.ts`
- Create: `agent-api/src/persistence/user-role-repository.ts`
- Create: `agent-api/src/persistence/user-role-repository.test.ts`
- Create: `agent-api/src/persistence/role-permission-repository.ts`
- Create: `agent-api/src/persistence/role-permission-repository.test.ts`
- Create: `agent-api/src/persistence/admin-audit-log-repository.ts`
- Create: `agent-api/src/persistence/admin-audit-log-repository.test.ts`
- Create: `agent-api/src/rbac/seed-system-rbac.ts`
- Create: `agent-api/src/rbac/seed-system-rbac.test.ts`
- Modify: `agent-api/src/persistence/user-repository.ts`
- Modify: `agent-api/src/persistence/user-repository.test.ts`

- [ ] **Step 1: Write failing repository and seed tests**

Add tests proving:

```ts
it("creates system roles and built-in permissions idempotently", async () => {
  const db = new FakeRbacDb();
  const seed = new SeedSystemRbacService({ roles: new RoleRepository(db), permissions: new PermissionRepository(db), rolePermissions: new RolePermissionRepository(db) });

  await seed.run();
  await seed.run();

  expect(db.roles.map((item) => item.slug)).toEqual(["super_admin", "admin"]);
  expect(new Set(db.permissions.map((item) => item.key))).toContain("role.write");
});

it("replaces a user's assigned roles while preserving exactly one primary role", async () => {
  const repository = new UserRoleRepository(new FakeRbacDb());

  await repository.replaceUserRoles({
    userId: "user-1",
    assignments: [
      { roleId: "role-employee", isPrimary: false },
      { roleId: "role-admin", isPrimary: true }
    ],
    mirrorLegacyRole: "admin"
  });

  expect(await repository.listForUser("user-1")).toEqual([
    expect.objectContaining({ roleId: "role-employee", isPrimary: false }),
    expect.objectContaining({ roleId: "role-admin", isPrimary: true })
  ]);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail for missing repositories**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- role-repository.test.ts permission-repository.test.ts user-role-repository.test.ts role-permission-repository.test.ts admin-audit-log-repository.test.ts seed-system-rbac.test.ts
```

Expected: FAIL because the repository and seed files do not exist yet.

- [ ] **Step 3: Implement the repositories with small focused methods**

Implement methods such as:

```ts
class RoleRepository {
  list(): Promise<RoleRecord[]> {}
  getById(roleId: string): Promise<RoleRecord | null> {}
  getBySlug(slug: string): Promise<RoleRecord | null> {}
  create(input: CreateRoleInput): Promise<RoleRecord> {}
  update(input: UpdateRoleInput): Promise<RoleRecord> {}
  disable(roleId: string): Promise<RoleRecord> {}
  clone(input: { sourceRoleId: string; slug: string; name: string; description?: string | null }): Promise<RoleRecord> {}
}

class UserRoleRepository {
  listForUser(userId: string): Promise<UserRoleAssignment[]> {}
  replaceUserRoles(input: { userId: string; assignments: Array<{ roleId: string; isPrimary: boolean }>; mirrorLegacyRole: string }): Promise<void> {}
}
```

Implementation rules:

- reject multiple primary assignments
- reject assignments to disabled roles
- mirror the selected primary role into `users.role`
- forbid disabling `super_admin` and `admin`
- keep clone behavior limited to custom-role output even when the source is a system role

- [ ] **Step 4: Implement the seed service**

Implement `seed-system-rbac.ts` with a `run()` method that upserts:

- roles: `super_admin`, `admin`
- built-in permission keys from the spec
- baseline `role_permissions` bindings so `admin` covers the existing admin surfaces and `super_admin` has all built-in keys

- [ ] **Step 5: Run focused repository tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- role-repository.test.ts permission-repository.test.ts user-role-repository.test.ts role-permission-repository.test.ts admin-audit-log-repository.test.ts seed-system-rbac.test.ts user-repository.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit repository and seed work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/rbac /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/user-repository.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/user-repository.test.ts
git commit -m "feat: add rbac repositories and seeds"
```

### Task 3: Add permission evaluation and request guards

**Files:**
- Create: `agent-api/src/rbac/permission-service.ts`
- Create: `agent-api/src/rbac/permission-service.test.ts`
- Create: `agent-api/src/auth/permission-guard.ts`
- Create: `agent-api/src/auth/permission-guard.test.ts`
- Modify: `agent-api/src/app-routes.ts`
- Modify: `agent-api/src/index.ts`

- [ ] **Step 1: Write failing permission-evaluation and guard tests**

Add tests like:

```ts
it("grants a permission when any assigned active role contains it", async () => {
  const service = buildPermissionServiceForTest({
    userRoles: [
      { userId: "user-1", roleId: "role-employee", isPrimary: true },
      { userId: "user-1", roleId: "role-auditor", isPrimary: false }
    ],
    rolePermissions: [{ roleId: "role-auditor", permissionKey: "audit.read" }]
  });

  expect(await service.hasPermission({ userId: "user-1", legacyRole: "employee", permissionKey: "audit.read" })).toBe(true);
});

it("lets super_admin bypass explicit permission assignment", async () => {
  const service = buildPermissionServiceForTest();
  expect(await service.hasPermission({ userId: "root-1", legacyRole: "super_admin", permissionKey: "role.write" })).toBe(true);
});

it("returns 403 when a request lacks the required permission", async () => {
  const app = buildPermissionGuardApp({ currentUser: { id: "user-1", role: "employee" } });
  const response = await request(app).get("/guarded");
  expect(response.status).toBe(403);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- permission-service.test.ts permission-guard.test.ts
```

Expected: FAIL because the service and guard do not exist yet.

- [ ] **Step 3: Implement the permission service and guard**

Implement interfaces like:

```ts
export class PermissionService {
  async listEffectiveRoleIdsForUser(input: { userId: string; legacyRole?: string }): Promise<string[]> {}
  async hasPermission(input: { userId: string; legacyRole?: string; permissionKey: string }): Promise<boolean> {}
}

export function requirePermission(permissionKey: string): RequestHandler {}
```

Rules:

- active assigned roles contribute permissions by union
- if no user-role rows exist yet, fall back to the mirrored legacy role slug where possible
- `super_admin` always returns `true`
- return 401 when unauthenticated and 403 when authenticated without the permission

- [ ] **Step 4: Wire permission-aware admin routing without destabilizing unchanged paths**

Update `app-routes.ts` and `index.ts` so:

- the new RBAC router uses `requirePermission(...)`
- existing org-sync and admin overview paths may remain on `requireRole("admin")` until later tasks migrate them
- the permission service is instantiated once and passed to RBAC routes

- [ ] **Step 5: Run focused tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- permission-service.test.ts permission-guard.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit permission service work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/rbac/permission-service* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/auth/permission-guard* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/app-routes.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts
git commit -m "feat: add rbac permission guards"
```

### Task 4: Add admin RBAC APIs, including unified role-detail resource authorization and audit writes

**Files:**
- Create: `agent-api/src/admin/rbac-router.ts`
- Create: `agent-api/src/admin/rbac-router.test.ts`
- Modify: `agent-api/src/admin/router.ts`
- Modify: `agent-api/src/admin/router.test.ts`
- Modify: `agent-api/src/resources/policy-service.ts`
- Modify: `agent-api/src/resources/policy-service.test.ts`

- [ ] **Step 1: Write failing admin API tests for role management, user-role assignment, and role-scoped resource policy updates**

Add tests like:

```ts
it("creates a custom role and records an audit log", async () => {
  const response = await request(app)
    .post("/api/admin/roles")
    .set("Cookie", cookies.create(adminUser.id))
    .send({ slug: "ops_manager", name: "Ops Manager", description: "Operations managers" });

  expect(response.status).toBe(201);
  expect(response.body.role.slug).toBe("ops_manager");
  expect(db.auditLogs).toEqual([
    expect.objectContaining({ actionType: "role.created", targetType: "role" })
  ]);
});

it("replaces user roles with one primary role", async () => {
  const response = await request(app)
    .put("/api/admin/users/user-1/roles")
    .set("Cookie", cookies.create(adminUser.id))
    .send({ assignments: [
      { roleId: "role-employee", isPrimary: false },
      { roleId: "role-admin", isPrimary: true }
    ] });

  expect(response.status).toBe(200);
  expect(response.body.userRoles).toEqual([
    expect.objectContaining({ roleId: "role-employee", isPrimary: false }),
    expect.objectContaining({ roleId: "role-admin", isPrimary: true })
  ]);
});

it("updates role-scoped resource policies without touching other subjects", async () => {
  await request(app)
    .put("/api/admin/roles/role-ops/resource-policies")
    .set("Cookie", cookies.create(adminUser.id))
    .send({ resourceType: "workspace", policies: [{ resourceId: "workspace-rd", effect: "allow" }] });

  expect(db.resourcePolicies).toContainEqual(expect.objectContaining({ subjectType: "role", subjectId: "role-ops", resourceId: "workspace-rd" }));
  expect(db.resourcePolicies).toContainEqual(expect.objectContaining({ subjectType: "user", subjectId: "user-1" }));
});
```

- [ ] **Step 2: Run focused RBAC admin tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- rbac-router.test.ts admin/router.test.ts policy-service.test.ts
```

Expected: FAIL because the RBAC router and related behavior are not implemented yet.

- [ ] **Step 3: Implement the RBAC router and unify role detail behavior**

Add routes:

- `GET /api/admin/roles`
- `POST /api/admin/roles`
- `GET /api/admin/roles/:roleId`
- `PATCH /api/admin/roles/:roleId`
- `POST /api/admin/roles/:roleId/clone`
- `POST /api/admin/roles/:roleId/disable`
- `GET /api/admin/roles/:roleId/permissions`
- `PUT /api/admin/roles/:roleId/permissions`
- `GET /api/admin/roles/:roleId/resource-policies`
- `PUT /api/admin/roles/:roleId/resource-policies`
- `GET /api/admin/roles/:roleId/members`
- `GET /api/admin/permissions`
- `GET /api/admin/users/:userId/roles`
- `PUT /api/admin/users/:userId/roles`
- `GET /api/admin/audit-logs`

Implementation rules:

- protect read/write actions with explicit permissions such as `role.read`, `role.write`, `permission.assign`, `user.role.assign`, `resource_policy.write`, and `audit.read`
- role detail responses should bundle role basics, permissions, resource policies, member count, and recent audit entries
- role-scoped resource authorization writes must call the existing `resource_policies` replacement logic only for `subjectType: "role"` and the selected role id
- all mutating handlers must write audit log entries

- [ ] **Step 4: Extend user-management responses to return assigned roles and primary role metadata**

Update admin user payloads so the frontend can render:

```json
{
  "assignedRoles": [
    { "roleId": "role-admin", "slug": "admin", "name": "Admin", "isPrimary": true }
  ],
  "primaryRole": { "roleId": "role-admin", "slug": "admin", "name": "Admin" }
}
```

Keep the legacy `local.role` field until the migration is complete.

- [ ] **Step 5: Run focused RBAC admin tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- rbac-router.test.ts admin/router.test.ts policy-service.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit RBAC admin API work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/policy-service.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/policy-service.test.ts
git commit -m "feat: add rbac admin api"
```

### Task 5: Add admin-console role management, permission matrix, unified role detail, and user multi-role assignment

**Files:**
- Create: `agent-ui/src/features/rbac/types.ts`
- Create: `agent-ui/src/features/rbac/api.ts`
- Create: `agent-ui/src/features/rbac/RolesView.tsx`
- Create: `agent-ui/src/features/rbac/RolesView.test.tsx`
- Create: `agent-ui/src/features/rbac/RoleDetailView.tsx`
- Create: `agent-ui/src/features/rbac/RoleDetailView.test.tsx`
- Create: `agent-ui/src/features/rbac/UserRoleEditor.tsx`
- Create: `agent-ui/src/features/rbac/UserRoleEditor.test.tsx`
- Create: `agent-ui/src/features/rbac/PermissionMatrix.tsx`
- Create: `agent-ui/src/features/rbac/PermissionMatrix.test.tsx`
- Create: `agent-ui/src/features/rbac/RoleAuditView.tsx`
- Create: `agent-ui/src/features/rbac/RoleAuditView.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/features/admin/UsersView.tsx`
- Modify: `agent-ui/src/features/admin/UsersView.test.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing admin UI tests for role list, role detail, and multi-role user editing**

Add tests like:

```tsx
it("navigates from the admin shell into the roles view", async () => {
  render(<AdminShell />);
  fireEvent.click(screen.getByRole("tab", { name: "角色权限" }));
  expect(await screen.findByText("角色列表")).toBeTruthy();
});

it("saves multi-role assignments with one primary role", async () => {
  render(<UserRoleEditor userId="user-1" />);
  await screen.findByText("Admin");
  fireEvent.click(screen.getByLabelText("选择角色 ops_manager"));
  fireEvent.click(screen.getByLabelText("设为主角色 admin"));
  fireEvent.click(screen.getByRole("button", { name: "保存角色分配" }));

  expect(mockPutAdminUserRoles).toHaveBeenCalledWith("user-1", {
    assignments: [
      { roleId: "role-admin", isPrimary: true },
      { roleId: "role-ops", isPrimary: false }
    ]
  });
});

it("edits role permissions and role-scoped resource policies from one detail view", async () => {
  render(<RoleDetailView roleId="role-ops" />);
  await screen.findByText("功能权限");
  fireEvent.click(screen.getByLabelText("permission role.write"));
  fireEvent.click(screen.getByRole("tab", { name: "资源授权" }));
  fireEvent.click(screen.getByLabelText("workspace workspace-rd allow"));
  fireEvent.click(screen.getByRole("button", { name: "保存角色配置" }));

  expect(mockPutRolePermissions).toHaveBeenCalled();
  expect(mockPutRoleResourcePolicies).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused frontend tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- RolesView.test.tsx RoleDetailView.test.tsx UserRoleEditor.test.tsx PermissionMatrix.test.tsx RoleAuditView.test.tsx AdminShell.test.tsx UsersView.test.tsx
```

Expected: FAIL because the RBAC UI files do not exist yet.

- [ ] **Step 3: Implement typed RBAC API helpers and focused components**

Add typed frontend helpers such as:

```ts
export async function fetchRoles(): Promise<RoleListResponse> {}
export async function fetchRoleDetail(roleId: string): Promise<RoleDetailResponse> {}
export async function createRole(input: CreateRoleInput): Promise<RoleDetailResponse> {}
export async function cloneRole(roleId: string, input: CloneRoleInput): Promise<RoleDetailResponse> {}
export async function disableRole(roleId: string): Promise<RoleDetailResponse> {}
export async function putRolePermissions(roleId: string, input: ReplaceRolePermissionsInput): Promise<RolePermissionResponse> {}
export async function putRoleResourcePolicies(roleId: string, input: ReplaceRoleResourcePoliciesInput): Promise<RoleResourcePolicyResponse> {}
export async function fetchUserRoles(userId: string): Promise<UserRoleResponse> {}
export async function putUserRoles(userId: string, input: ReplaceUserRolesInput): Promise<UserRoleResponse> {}
export async function fetchRoleAuditLogs(roleId: string): Promise<RoleAuditLogResponse> {}
```

Build components with focused responsibility:

- `RolesView` for list/create/clone/disable
- `RoleDetailView` for tabs and save flows
- `PermissionMatrix` for grouped function permissions
- `UserRoleEditor` for multi-role user assignment and primary-role selection
- `RoleAuditView` for audit entries only

- [ ] **Step 4: Refactor admin shell and user management to use the new RBAC views**

Update the admin shell so the navigation includes `角色权限`, and evolve `UsersView` to show assigned roles plus an action that opens the multi-role editor instead of only editing a single role string.

- [ ] **Step 5: Run focused frontend tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- RolesView.test.tsx RoleDetailView.test.tsx UserRoleEditor.test.tsx PermissionMatrix.test.tsx RoleAuditView.test.tsx AdminShell.test.tsx UsersView.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit RBAC frontend work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/rbac /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css
git commit -m "feat: add rbac admin console"
```

### Task 6: Run migration compatibility checks and full verification

**Files:**
- Modify: none required unless verification exposes defects

- [ ] **Step 1: Run backend verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test
npm run build
npm run prisma:generate
```

Expected: PASS.

- [ ] **Step 2: Run frontend verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 3: Verify compatibility behavior for legacy role mirroring**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- user-role-repository.test.ts permission-service.test.ts admin/router.test.ts
```

Expected: PASS, confirming that user primary roles mirror into legacy `users.role` and unchanged paths still behave.

- [ ] **Step 4: Commit any verification-driven fixes**

```bash
git add -A
git commit -m "fix: align rbac verification issues"
```

Only do this step if verification required code fixes.
