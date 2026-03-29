# DingTalk Organization Sync And Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DingTalk organization sync, persisted departments and membership metadata, sync jobs/snapshots/diffs, scheduled sync, and actionable admin user/department management backed by the existing admin shell.

**Architecture:** Extend the Prisma schema so users, departments, memberships, and sync history are first-class persisted models. Reuse the existing DingTalk auth client by adding organization-fetch methods, then build a provider adapter plus a shared sync service used by both manual admin routes and a lightweight scheduler. Expand the admin API and React admin shell so administrators can trigger syncs, inspect jobs, browse departments, and edit only local user governance fields.

**Tech Stack:** TypeScript, Prisma ORM, PostgreSQL, Express, React, Vite, assistant-ui, Vitest, Supertest, lightweight in-process scheduler.

---

## File Structure

### Backend

- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/20260329170000_add_dingtalk_org_sync/migration.sql`
- Modify: `agent-api/src/auth/dingtalk.ts`
- Modify: `agent-api/src/auth/dingtalk.test.ts`
- Modify: `agent-api/src/persistence/user-repository.ts`
- Modify: `agent-api/src/persistence/user-repository.test.ts`
- Modify: `agent-api/src/persistence/department-membership-repository.ts`
- Create: `agent-api/src/persistence/department-repository.ts`
- Create: `agent-api/src/persistence/department-repository.test.ts`
- Create: `agent-api/src/persistence/sync-job-repository.ts`
- Create: `agent-api/src/persistence/sync-job-repository.test.ts`
- Create: `agent-api/src/org-sync/dingtalk-org-provider.ts`
- Create: `agent-api/src/org-sync/dingtalk-org-provider.test.ts`
- Create: `agent-api/src/org-sync/org-sync-service.ts`
- Create: `agent-api/src/org-sync/org-sync-service.test.ts`
- Create: `agent-api/src/org-sync/org-sync-scheduler.ts`
- Create: `agent-api/src/org-sync/org-sync-scheduler.test.ts`
- Create: `agent-api/src/admin/org-sync-router.ts`
- Create: `agent-api/src/admin/org-sync-router.test.ts`
- Modify: `agent-api/src/admin/router.ts`
- Modify: `agent-api/src/admin/router.test.ts`
- Modify: `agent-api/src/index.ts`
- Modify: `agent-api/src/config.ts`

### Frontend

- Create: `agent-ui/src/features/admin/api.ts`
- Create: `agent-ui/src/features/admin/types.ts`
- Create: `agent-ui/src/features/admin/AdminNav.tsx`
- Create: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Create: `agent-ui/src/features/admin/UsersView.tsx`
- Create: `agent-ui/src/features/admin/UsersView.test.tsx`
- Create: `agent-ui/src/features/admin/OrgSyncView.tsx`
- Create: `agent-ui/src/features/admin/OrgSyncView.test.tsx`
- Create: `agent-ui/src/features/admin/DepartmentTreeView.tsx`
- Create: `agent-ui/src/features/admin/DepartmentTreeView.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/styles.css`

### Docs

- Reference: `docs/superpowers/specs/2026-03-29-agent-studio-dingtalk-org-sync-design.md`

## Notes

- Keep role editing limited to existing role strings already used by the app.
- Keep DingTalk-owned fields read-only end-to-end; do not add PATCH routes for synced profile data.
- Keep sync logic behind one application service so manual routes and scheduled jobs call the same code.
- Treat this as a single-provider implementation with a provider adapter boundary, not as a full identity platform.

### Task 1: Extend Prisma schema for departments, membership metadata, user sync state, and sync history

**Files:**
- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/20260329170000_add_dingtalk_org_sync/migration.sql`

- [ ] **Step 1: Run a failing Prisma diff check for the new organization tables**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE "(departments|sync_jobs|sync_job_events|sync_snapshots|sync_diffs)"'
```

Expected: FAIL because the current schema does not define these tables yet.

- [ ] **Step 2: Extend `schema.prisma` with user, department, membership, and sync models**

Add or update models like this:

```prisma
model User {
  id                 String                 @id @default(cuid())
  externalId         String?                @unique @map("external_id")
  email              String?
  displayName        String?                @map("display_name")
  role               String                 @default("employee")
  status             String                 @default("active")
  statusSource       String                 @default("sync") @map("status_source")
  syncState          String                 @default("active") @map("sync_state")
  manualDisabled     Boolean                @default(false) @map("manual_disabled")
  adminNote          String?                @map("admin_note")
  lastSyncedAt       DateTime?              @map("last_synced_at")
  dingtalkOpenId     String?                @map("dingtalk_open_id")
  dingtalkUserId     String?                @unique @map("dingtalk_user_id")
  dingtalkCorpId     String?                @map("dingtalk_corp_id")
  createdAt          DateTime               @default(now()) @map("created_at")
  updatedAt          DateTime               @updatedAt @map("updated_at")
  threads            Thread[]
  runtimeSessions    RuntimeSession[]
  departmentMemberships DepartmentMembership[]
  triggeredSyncJobs  SyncJob[]              @relation("SyncJobTriggeredBy")

  @@index([email])
  @@index([status, role])
  @@map("users")
}

model Department {
  id                 String                 @id @default(cuid())
  organizationId     String?                @map("organization_id")
  externalId         String                 @unique @map("external_id")
  name               String
  parentDepartmentId String?                @map("parent_department_id")
  sortOrder          Int                    @default(0) @map("sort_order")
  status             String                 @default("active")
  lastSyncedAt       DateTime?              @map("last_synced_at")
  createdAt          DateTime               @default(now()) @map("created_at")
  updatedAt          DateTime               @updatedAt @map("updated_at")
  parentDepartment   Department?            @relation("DepartmentTree", fields: [parentDepartmentId], references: [id], onDelete: SetNull)
  childDepartments   Department[]           @relation("DepartmentTree")
  memberships        DepartmentMembership[]

  @@index([parentDepartmentId])
  @@map("departments")
}

model DepartmentMembership {
  id           String      @id @default(cuid())
  userId       String      @map("user_id")
  departmentId String      @map("department_id")
  isPrimary    Boolean     @default(false) @map("is_primary")
  source       String      @default("sync")
  lastSyncedAt DateTime?   @map("last_synced_at")
  createdAt    DateTime    @default(now()) @map("created_at")
  updatedAt    DateTime    @updatedAt @map("updated_at")

  user         User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  department   Department  @relation(fields: [departmentId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([departmentId, createdAt])
  @@unique([userId, departmentId])
  @@map("department_memberships")
}

model SyncJob {
  id                String          @id @default(cuid())
  organizationId    String?         @map("organization_id")
  provider          String          @default("dingtalk")
  scopeType         String          @map("scope_type")
  scopeExternalId   String?         @map("scope_external_id")
  status            String          @default("pending")
  triggerType       String          @map("trigger_type")
  triggeredByUserId String?         @map("triggered_by_user_id")
  startedAt         DateTime?       @map("started_at")
  finishedAt        DateTime?       @map("finished_at")
  summary           Json?
  createdAt         DateTime        @default(now()) @map("created_at")
  updatedAt         DateTime        @updatedAt @map("updated_at")
  triggeredByUser   User?           @relation("SyncJobTriggeredBy", fields: [triggeredByUserId], references: [id], onDelete: SetNull)
  events            SyncJobEvent[]
  snapshots         SyncSnapshot[]
  diffs             SyncDiff[]

  @@index([status, createdAt])
  @@index([scopeType, scopeExternalId])
  @@map("sync_jobs")
}

model SyncJobEvent {
  id        String    @id @default(cuid())
  syncJobId String    @map("sync_job_id")
  level     String
  eventType String    @map("event_type")
  message   String
  payload   Json?
  createdAt DateTime  @default(now()) @map("created_at")
  syncJob   SyncJob   @relation(fields: [syncJobId], references: [id], onDelete: Cascade)

  @@index([syncJobId, createdAt])
  @@map("sync_job_events")
}

model SyncSnapshot {
  id              String    @id @default(cuid())
  syncJobId       String    @map("sync_job_id")
  entityType      String    @map("entity_type")
  scopeType       String    @map("scope_type")
  scopeExternalId String?   @map("scope_external_id")
  snapshotPayload Json      @map("snapshot_payload")
  createdAt       DateTime  @default(now()) @map("created_at")
  syncJob         SyncJob   @relation(fields: [syncJobId], references: [id], onDelete: Cascade)

  @@index([syncJobId, entityType])
  @@map("sync_snapshots")
}

model SyncDiff {
  id               String    @id @default(cuid())
  syncJobId        String    @map("sync_job_id")
  entityType       String    @map("entity_type")
  entityExternalId String?   @map("entity_external_id")
  changeType       String    @map("change_type")
  beforePayload    Json?     @map("before_payload")
  afterPayload     Json?     @map("after_payload")
  createdAt        DateTime  @default(now()) @map("created_at")
  syncJob          SyncJob   @relation(fields: [syncJobId], references: [id], onDelete: Cascade)

  @@index([syncJobId, entityType])
  @@map("sync_diffs")
}
```

- [ ] **Step 3: Create the SQL migration matching the schema update**

Create `agent-api/prisma/migrations/20260329170000_add_dingtalk_org_sync/migration.sql` with concrete DDL for:

```sql
ALTER TABLE "users"
  ADD COLUMN "status_source" TEXT NOT NULL DEFAULT 'sync',
  ADD COLUMN "sync_state" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "manual_disabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "admin_note" TEXT,
  ADD COLUMN "last_synced_at" TIMESTAMP(3);

ALTER TABLE "department_memberships"
  ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'sync',
  ADD COLUMN "last_synced_at" TIMESTAMP(3);

CREATE TABLE "departments" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "external_id" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "parent_department_id" TEXT REFERENCES "departments"("id") ON DELETE SET NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sync_jobs" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'dingtalk',
  "scope_type" TEXT NOT NULL,
  "scope_external_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "trigger_type" TEXT NOT NULL,
  "triggered_by_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sync_job_events" (
  "id" TEXT PRIMARY KEY,
  "sync_job_id" TEXT NOT NULL REFERENCES "sync_jobs"("id") ON DELETE CASCADE,
  "level" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sync_snapshots" (
  "id" TEXT PRIMARY KEY,
  "sync_job_id" TEXT NOT NULL REFERENCES "sync_jobs"("id") ON DELETE CASCADE,
  "entity_type" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_external_id" TEXT,
  "snapshot_payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sync_diffs" (
  "id" TEXT PRIMARY KEY,
  "sync_job_id" TEXT NOT NULL REFERENCES "sync_jobs"("id") ON DELETE CASCADE,
  "entity_type" TEXT NOT NULL,
  "entity_external_id" TEXT,
  "change_type" TEXT NOT NULL,
  "before_payload" JSONB,
  "after_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Also add supporting indexes that match the Prisma definitions.

- [ ] **Step 4: Regenerate Prisma client and rerun the diff check**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm run prisma:generate
npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE "(departments|sync_jobs|sync_job_events|sync_snapshots|sync_diffs)"'
```

Expected: PASS. Prisma generation succeeds and the diff prints the new table creation statements.

- [ ] **Step 5: Commit the schema work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma
git commit -m "feat: add dingtalk org sync schema"
```

### Task 2: Add repositories for departments, sync jobs, and local user governance fields

**Files:**
- Modify: `agent-api/src/persistence/user-repository.ts`
- Modify: `agent-api/src/persistence/user-repository.test.ts`
- Modify: `agent-api/src/persistence/department-membership-repository.ts`
- Create: `agent-api/src/persistence/department-repository.ts`
- Create: `agent-api/src/persistence/department-repository.test.ts`
- Create: `agent-api/src/persistence/sync-job-repository.ts`
- Create: `agent-api/src/persistence/sync-job-repository.test.ts`

- [ ] **Step 1: Add failing repository tests for department tree persistence and primary membership replacement**

Add tests like:

```ts
it("upserts a department tree and preserves parent-child links", async () => {
  const repo = createDepartmentRepositoryForTest();

  await repo.upsertMany([
    { externalId: "root", name: "总部", parentExternalId: null, sortOrder: 10, status: "active" },
    { externalId: "rd", name: "研发", parentExternalId: "root", sortOrder: 20, status: "active" }
  ]);

  const tree = await repo.listTree();
  expect(tree[0]).toMatchObject({ externalId: "root" });
  expect(tree[0].children[0]).toMatchObject({ externalId: "rd", parentExternalId: "root" });
});

it("replaces synced memberships and keeps only one primary record", async () => {
  const repo = createMembershipRepositoryForTest();
  await repo.replaceSyncedMemberships({
    userId: "user-1",
    memberships: [
      { departmentId: "dept-a", isPrimary: false },
      { departmentId: "dept-b", isPrimary: true }
    ]
  });

  const memberships = await repo.listForUser("user-1");
  expect(memberships.filter((item) => item.isPrimary)).toHaveLength(1);
  expect(memberships.map((item) => item.departmentId)).toEqual(["dept-a", "dept-b"]);
});
```

- [ ] **Step 2: Add failing repository tests for sync job lifecycle, events, snapshots, and diffs**

```ts
it("records sync jobs with events, snapshots, and diffs", async () => {
  const repo = createSyncJobRepositoryForTest();

  const job = await repo.create({ scopeType: "department", scopeExternalId: "rd", triggerType: "manual", triggeredByUserId: "admin-1" });
  await repo.markRunning(job.id, new Date("2026-03-29T09:00:00.000Z"));
  await repo.appendEvent(job.id, { level: "info", eventType: "remote_fetch_started", message: "Fetching department rd" });
  await repo.replaceSnapshots(job.id, [{ entityType: "department", scopeType: "department", scopeExternalId: "rd", snapshotPayload: [{ externalId: "rd", name: "研发" }] }]);
  await repo.replaceDiffs(job.id, [{ entityType: "department", entityExternalId: "rd", changeType: "updated", beforePayload: { name: "RD" }, afterPayload: { name: "研发" } }]);
  await repo.markSucceeded(job.id, { departmentsUpdated: 1 });

  const detail = await repo.getDetail(job.id);
  expect(detail?.status).toBe("succeeded");
  expect(detail?.events).toHaveLength(1);
  expect(detail?.snapshots).toHaveLength(1);
  expect(detail?.diffs[0]?.changeType).toBe("updated");
});
```

- [ ] **Step 3: Add failing repository tests for local user-settings updates**

```ts
it("updates local governance fields without mutating synced profile fields", async () => {
  const repo = createUserRepositoryForTest();
  await repo.upsertFromDingTalk({ dingtalkUserId: "ding-1", displayName: "Alice", email: "alice@corp.test" });

  const updated = await repo.updateLocalSettings({
    userId: "user-1",
    role: "admin",
    manualDisabled: true,
    adminNote: "temporary hold"
  });

  expect(updated.role).toBe("admin");
  expect(updated.manualDisabled).toBe(true);
  expect(updated.status).toBe("disabled");
  expect(updated.displayName).toBe("Alice");
});
```

- [ ] **Step 4: Implement `DepartmentRepository` and extend membership/user repositories minimally to satisfy tests**

Create repository APIs like:

```ts
export class DepartmentRepository {
  async upsertMany(input: Array<{ externalId: string; name: string; parentExternalId?: string | null; sortOrder?: number; status?: string; lastSyncedAt?: Date | null }>) {}
  async listTree(): Promise<Array<DepartmentTreeNode>> {}
  async getByExternalId(externalId: string): Promise<DepartmentRecord | null> {}
  async getById(id: string): Promise<DepartmentRecord | null> {}
}

export class DepartmentMembershipRepository {
  async replaceSyncedMemberships(input: { userId: string; memberships: Array<{ departmentId: string; isPrimary: boolean }>; syncedAt?: Date }): Promise<void> {}
  async listForUser(userId: string): Promise<Array<{ departmentId: string; isPrimary: boolean }>> {}
}

export class UserRepository {
  async updateLocalSettings(input: { userId: string; role: string; manualDisabled: boolean; adminNote?: string | null }): Promise<UserRecord> {}
}
```

Implementation rules:
- membership replacement clears only synced memberships for that user, then inserts current memberships
- only one primary membership is persisted; reject invalid inputs with multiple primaries
- `updateLocalSettings` sets `status = "disabled"` and `statusSource = "manual_disable"` when `manualDisabled` is true
- re-enabling through local settings clears `manualDisabled` and restores `statusSource = "sync"`, but does not fabricate sync profile changes

- [ ] **Step 5: Implement `SyncJobRepository` to manage jobs, events, snapshots, and diffs**

Use methods like:

```ts
export class SyncJobRepository {
  async create(input: { scopeType: string; scopeExternalId?: string | null; triggerType: string; triggeredByUserId?: string | null }): Promise<SyncJobRecord> {}
  async markRunning(jobId: string, startedAt: Date): Promise<void> {}
  async appendEvent(jobId: string, input: { level: string; eventType: string; message: string; payload?: unknown }): Promise<void> {}
  async replaceSnapshots(jobId: string, input: Array<{ entityType: string; scopeType: string; scopeExternalId?: string | null; snapshotPayload: unknown }>): Promise<void> {}
  async replaceDiffs(jobId: string, input: Array<{ entityType: string; entityExternalId?: string | null; changeType: string; beforePayload?: unknown; afterPayload?: unknown }>): Promise<void> {}
  async markSucceeded(jobId: string, summary: unknown): Promise<void> {}
  async markFailed(jobId: string, summary: unknown): Promise<void> {}
  async getDetail(jobId: string): Promise<SyncJobDetail | null> {}
  async listRecent(limit?: number): Promise<SyncJobRecord[]> {}
}
```

- [ ] **Step 6: Run focused repository tests**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- department-repository.test.ts sync-job-repository.test.ts user-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit repository work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence
git commit -m "feat: add org sync repositories"
```

### Task 3: Extend the DingTalk client and add an organization provider adapter

**Files:**
- Modify: `agent-api/src/auth/dingtalk.ts`
- Modify: `agent-api/src/auth/dingtalk.test.ts`
- Create: `agent-api/src/org-sync/dingtalk-org-provider.ts`
- Create: `agent-api/src/org-sync/dingtalk-org-provider.test.ts`

- [ ] **Step 1: Add failing tests for department and user fetch methods in the DingTalk client**

Add test cases like:

```ts
it("fetches department children from DingTalk", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(makeJsonResponse({ accessToken: "token-1", expireIn: 7200 }))
    .mockResolvedValueOnce(makeJsonResponse({ result: [{ deptId: "1", name: "总部", parentId: "0", order: 10 }] }));

  const client = createDingTalkClient(makeConfig(), { fetch: fetchMock as never });
  const departments = await client.listDepartments({ parentId: "0" });

  expect(departments[0]).toMatchObject({ externalId: "1", name: "总部", parentExternalId: "0" });
});

it("fetches department user details and lifecycle state", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(makeJsonResponse({ accessToken: "token-1", expireIn: 7200 }))
    .mockResolvedValueOnce(makeJsonResponse({ result: { list: [{ userid: "u1", unionid: "union-1", name: "Alice", active: true, dept_id_list: [1, 2] }] } }));

  const client = createDingTalkClient(makeConfig(), { fetch: fetchMock as never });
  const users = await client.listDepartmentUsers({ departmentId: "1" });

  expect(users[0]).toMatchObject({ userId: "u1", displayName: "Alice", departmentExternalIds: ["1", "2"], lifecycleState: "active" });
});
```

- [ ] **Step 2: Extend `auth/dingtalk.ts` with organization-oriented methods and types**

Add methods and normalized return shapes:

```ts
export type DingTalkDepartment = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  sortOrder: number;
};

export type DingTalkOrganizationUser = {
  userId: string;
  unionId?: string;
  openId?: string;
  displayName: string;
  email?: string;
  departmentExternalIds: string[];
  primaryDepartmentExternalId?: string;
  lifecycleState: "active" | "disabled" | "departed";
};

export interface DingTalkClient {
  exchangeCode(code: string): Promise<DingTalkUserIdentity>;
  listDepartments(input: { parentId?: string | null }): Promise<DingTalkDepartment[]>;
  listDepartmentUsers(input: { departmentId: string }): Promise<DingTalkOrganizationUser[]>;
  getUser(input: { userId: string }): Promise<DingTalkOrganizationUser | null>;
}
```

Keep HTTP-specific mapping inside the client; provider code should receive normalized objects only.

- [ ] **Step 3: Add a provider adapter that expands scoped sync input into normalized snapshots**

Create `agent-api/src/org-sync/dingtalk-org-provider.ts` with an API like:

```ts
export class DingTalkOrgProvider {
  constructor(private readonly client: DingTalkClient) {}

  async fetchFullOrganization(): Promise<NormalizedOrgSnapshot> {}
  async fetchDepartmentScope(externalDepartmentId: string): Promise<NormalizedOrgSnapshot> {}
  async fetchUserScope(externalUserId: string): Promise<NormalizedOrgSnapshot> {}
}
```

Add tests proving:
- full scope walks the department tree breadth-first or depth-first without dropping nodes
- department scope returns the selected department subtree and its current members
- user scope returns just the target user and the user’s linked departments
- provider converts DingTalk active/disabled/departed fields into normalized lifecycle states

- [ ] **Step 4: Run focused provider tests**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- dingtalk.test.ts dingtalk-org-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit provider work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/auth /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/org-sync/dingtalk-org-provider*
git commit -m "feat: add dingtalk org provider"
```

### Task 4: Build the shared organization sync service and scheduler

**Files:**
- Create: `agent-api/src/org-sync/org-sync-service.ts`
- Create: `agent-api/src/org-sync/org-sync-service.test.ts`
- Create: `agent-api/src/org-sync/org-sync-scheduler.ts`
- Create: `agent-api/src/org-sync/org-sync-scheduler.test.ts`
- Modify: `agent-api/src/config.ts`
- Modify: `agent-api/src/index.ts`

- [ ] **Step 1: Add failing service tests for full, department, and user sync behavior**

Add tests like:

```ts
it("creates departments, users, memberships, snapshots, and diffs during a full sync", async () => {
  const service = buildOrgSyncServiceForTest({ providerSnapshot: makeFullSnapshot() });

  const result = await service.run({ scopeType: "full", triggerType: "manual", triggeredByUserId: "admin-1" });

  expect(result.status).toBe("succeeded");
  expect(await repositories.departments.listTree()).toHaveLength(1);
  expect(await repositories.syncJobs.listRecent()).toHaveLength(1);
  expect((await repositories.syncJobs.getDetail(result.jobId))?.diffs.length).toBeGreaterThan(0);
});

it("preserves manual disables when DingTalk later reports the user active", async () => {
  const service = buildOrgSyncServiceForTest({ existingUser: { manualDisabled: true, status: "disabled", statusSource: "manual_disable" }, providerSnapshot: makeActiveUserSnapshot() });

  await service.run({ scopeType: "user", scopeExternalId: "ding-u1", triggerType: "manual", triggeredByUserId: "admin-1" });

  const user = await repositories.users.getByDingTalkUserId("ding-u1");
  expect(user?.manualDisabled).toBe(true);
  expect(user?.status).toBe("disabled");
  expect(user?.statusSource).toBe("manual_disable");
});

it("blocks overlapping runs for the same scope while one job is running", async () => {
  const service = buildOrgSyncServiceForTest({ runningJob: { scopeType: "department", scopeExternalId: "rd", status: "running" } });

  await expect(service.run({ scopeType: "department", scopeExternalId: "rd", triggerType: "manual", triggeredByUserId: "admin-1" })).rejects.toThrow("already running");
});
```

- [ ] **Step 2: Implement the core sync service with diffing and status resolution**

Create a service with one entry point:

```ts
export class OrgSyncService {
  async run(input: {
    scopeType: "full" | "department" | "user";
    scopeExternalId?: string;
    triggerType: "manual" | "scheduled";
    triggeredByUserId?: string;
  }): Promise<{ jobId: string; status: "succeeded" | "failed" }> {}
}
```

Implementation rules:
- create a pending job, then mark it running
- fetch normalized snapshot from `DingTalkOrgProvider`
- compute department, user, and membership diffs against local persistence
- upsert departments first, then users, then memberships
- write snapshots and diffs for the completed run
- if DingTalk lifecycle state is `disabled` or `departed`, set local `status = "disabled"` and `syncState` accordingly
- if lifecycle state is `active` and `manualDisabled = false`, set local `status = "active"`, `statusSource = "sync"`, and `syncState = "active"`
- if `manualDisabled = true`, preserve `status = "disabled"` regardless of snapshot lifecycle state
- emit job events for fetch start, fetch complete, diff summary, persistence complete, and failure

- [ ] **Step 3: Add a lightweight scheduler and config plumbing**

Add config fields to `agent-api/src/config.ts` like:

```ts
orgSync: {
  enabled: parseBoolean(process.env.ORG_SYNC_ENABLED, true),
  intervalMinutes: parseInteger(process.env.ORG_SYNC_INTERVAL_MINUTES, 24 * 60)
}
```

Create `org-sync-scheduler.ts` with an interface like:

```ts
export class OrgSyncScheduler {
  start(): void {}
  stop(): void {}
}
```

Scheduler rules:
- default interval is daily
- skip if disabled
- call `OrgSyncService.run({ scopeType: "full", triggerType: "scheduled" })`
- do not start another run if one full sync job is already active

- [ ] **Step 4: Wire the service and scheduler in `index.ts`**

Update startup wiring so:
- the existing DingTalk client is reused to create `DingTalkOrgProvider`
- repositories are instantiated once and passed into `OrgSyncService`
- admin routers receive the sync service and repositories they need
- scheduler starts only in the main server bootstrap path

- [ ] **Step 5: Run focused sync-service and scheduler tests**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- org-sync-service.test.ts org-sync-scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit sync engine work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/org-sync /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/config.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts
git commit -m "feat: add org sync service and scheduler"
```

### Task 5: Add admin API routes for org sync, users, and departments

**Files:**
- Create: `agent-api/src/admin/org-sync-router.ts`
- Create: `agent-api/src/admin/org-sync-router.test.ts`
- Modify: `agent-api/src/admin/router.ts`
- Modify: `agent-api/src/admin/router.test.ts`

- [ ] **Step 1: Add failing admin API tests for sync triggers and user local-settings updates**

Add tests like:

```ts
it("triggers a full org sync for admin users", async () => {
  const { app, cookies, adminUser, syncService } = await buildAdminAppForOrgSync();

  const response = await request(app)
    .post("/api/admin/org-sync/jobs")
    .set("Cookie", cookies.create(adminUser.id));

  expect(response.status).toBe(202);
  expect(syncService.run).toHaveBeenCalledWith(expect.objectContaining({ scopeType: "full", triggerType: "manual", triggeredByUserId: adminUser.id }));
});

it("rejects non-admin users from org sync routes", async () => {
  const { app, cookies, user } = await buildAdminAppForOrgSync();
  const response = await request(app)
    .post("/api/admin/org-sync/jobs")
    .set("Cookie", cookies.create(user.id));

  expect(response.status).toBe(403);
});

it("updates only local user settings", async () => {
  const { app, cookies, adminUser, users } = await buildAdminAppForOrgSync();
  const response = await request(app)
    .patch("/api/admin/users/user-1/local-settings")
    .set("Cookie", cookies.create(adminUser.id))
    .send({ role: "admin", manualDisabled: true, adminNote: "hold" });

  expect(response.status).toBe(200);
  expect(response.body.user.local.role).toBe("admin");
  expect(response.body.user.synced.displayName).toBe("Alice");
});
```

- [ ] **Step 2: Implement `/api/admin/org-sync` routes**

Create `org-sync-router.ts` with endpoints:

```ts
router.post("/jobs", async ...)
router.post("/jobs/department/:externalId", async ...)
router.post("/jobs/user/:externalId", async ...)
router.get("/jobs", async ...)
router.get("/jobs/:jobId", async ...)
router.get("/jobs/:jobId/events", async ...)
router.get("/jobs/:jobId/diffs", async ...)
```

Behavior:
- trigger routes return `202` with the created job or accepted result
- list/detail routes return persisted job data from `SyncJobRepository`
- overlapping-run and provider failures surface clear `detail` messages with appropriate 4xx/5xx status codes

- [ ] **Step 3: Extend `admin/router.ts` to serve user and department admin routes**

Add routes:

```ts
router.get("/users", async ...)
router.get("/users/:userId", async ...)
router.patch("/users/:userId/local-settings", async ...)
router.get("/departments/tree", async ...)
router.get("/departments/:departmentId", async ...)
router.get("/departments/:departmentId/users", async ...)
router.get("/org-sync/config", async ...)
```

Response-shape rule for user detail:

```json
{
  "user": {
    "id": "user-1",
    "synced": {
      "displayName": "Alice",
      "email": "alice@corp.test",
      "dingtalkUserId": "ding-u1",
      "departmentIds": ["dept-rd"]
    },
    "local": {
      "role": "admin",
      "manualDisabled": true,
      "adminNote": "hold"
    },
    "effective": {
      "status": "disabled",
      "statusSource": "manual_disable",
      "syncState": "active",
      "lastSyncedAt": "2026-03-29T09:00:00.000Z"
    }
  }
}
```

- [ ] **Step 4: Run focused admin API tests**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- admin/router.test.ts admin/org-sync-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit admin API work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin
git commit -m "feat: add org sync admin routes"
```

### Task 6: Expand the admin frontend with users, departments, and sync views

**Files:**
- Create: `agent-ui/src/features/admin/api.ts`
- Create: `agent-ui/src/features/admin/types.ts`
- Create: `agent-ui/src/features/admin/AdminNav.tsx`
- Create: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Create: `agent-ui/src/features/admin/UsersView.tsx`
- Create: `agent-ui/src/features/admin/UsersView.test.tsx`
- Create: `agent-ui/src/features/admin/OrgSyncView.tsx`
- Create: `agent-ui/src/features/admin/OrgSyncView.test.tsx`
- Create: `agent-ui/src/features/admin/DepartmentTreeView.tsx`
- Create: `agent-ui/src/features/admin/DepartmentTreeView.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Add failing frontend tests for admin navigation and local-field editing**

Add tests like:

```tsx
it("switches between overview, users, and organization sync views", async () => {
  render(<AdminShell />);

  expect(await screen.findByText("运行概览")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "用户" }));
  expect(await screen.findByText("用户管理")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "组织同步" }));
  expect(await screen.findByText("同步任务")) .toBeTruthy();
});

it("submits only local governance fields from the users view", async () => {
  render(<UsersView />);

  await screen.findByText("Alice");
  await userEvent.click(screen.getByRole("button", { name: "编辑 Alice" }));
  await userEvent.selectOptions(screen.getByLabelText("角色"), "admin");
  await userEvent.click(screen.getByLabelText("手动禁用"));
  await userEvent.type(screen.getByLabelText("备注"), "temporary hold");
  await userEvent.click(screen.getByRole("button", { name: "保存" }));

  expect(mockPatchUserLocalSettings).toHaveBeenCalledWith("user-1", {
    role: "admin",
    manualDisabled: true,
    adminNote: "temporary hold"
  });
});
```

- [ ] **Step 2: Add typed admin API helpers**

Create `agent-ui/src/features/admin/api.ts` and `types.ts` with helpers such as:

```ts
export async function fetchAdminOverview(): Promise<AdminOverview> {}
export async function fetchAdminUsers(query?: AdminUserQuery): Promise<AdminUserListResponse> {}
export async function fetchAdminUser(userId: string): Promise<AdminUserDetailResponse> {}
export async function patchAdminUserLocalSettings(userId: string, input: AdminUserLocalSettingsInput): Promise<AdminUserDetailResponse> {}
export async function fetchDepartmentTree(): Promise<DepartmentTreeResponse> {}
export async function fetchOrgSyncJobs(): Promise<OrgSyncJobListResponse> {}
export async function triggerFullOrgSync(): Promise<OrgSyncTriggerResponse> {}
export async function triggerDepartmentOrgSync(externalId: string): Promise<OrgSyncTriggerResponse> {}
export async function triggerUserOrgSync(externalId: string): Promise<OrgSyncTriggerResponse> {}
```

- [ ] **Step 3: Implement focused admin views instead of one oversized shell**

Create components with clear responsibilities:

```tsx
export function AdminNav(props: { section: AdminSection; onChange(section: AdminSection): void }) {}
export function UsersView() {}
export function DepartmentTreeView() {}
export function OrgSyncView() {}
```

Rules:
- `UsersView` owns filters, list rendering, and local field edit form
- `DepartmentTreeView` is read-only and shows tree plus member counts
- `OrgSyncView` shows cadence, trigger actions, recent jobs, and diff/error summaries
- time rendering must follow user local timezone

- [ ] **Step 4: Refactor `AdminShell.tsx` to compose the new views**

Update shell shape to something like:

```tsx
export function AdminShell() {
  const [section, setSection] = useState<AdminSection>("overview");

  return (
    <div className="admin-shell">
      <section className="admin-card">
        <p className="auth-eyebrow">Agent Studio Admin</p>
        <h1>管理控制台</h1>
        <AdminNav section={section} onChange={setSection} />
      </section>
      {section === "overview" ? <OverviewCard /> : null}
      {section === "users" ? <UsersView /> : null}
      {section === "organization" ? <><DepartmentTreeView /><OrgSyncView /></> : null}
    </div>
  );
}
```

Keep the overview card behavior intact while making the shell navigable.

- [ ] **Step 5: Run focused admin UI tests**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- AdminShell.test.tsx AdminNav.test.tsx UsersView.test.tsx DepartmentTreeView.test.tsx OrgSyncView.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit admin frontend work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css
git commit -m "feat: add admin org sync console"
```

### Task 7: Run full verification and capture rollout readiness

**Files:**
- Modify: none required unless verification reveals defects

- [ ] **Step 1: Run backend verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test
npm run build
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

- [ ] **Step 3: Run Prisma generation one more time against the final schema**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm run prisma:generate
```

Expected: PASS.

- [ ] **Step 4: Commit any verification-driven fixes**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio
git commit -m "fix: finalize dingtalk org sync rollout"
```

Only do this step if verification required code changes.

- [ ] **Step 5: Prepare branch-finish decision**

Use the completion workflow after verification:

```bash
git status --short
git log --oneline --decorate -n 10
```

Expected: clean working tree or only intentional release-note/doc changes.
