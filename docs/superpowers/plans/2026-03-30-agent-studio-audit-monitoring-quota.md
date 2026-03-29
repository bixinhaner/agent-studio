# Agent Studio Audit, Monitoring, Quota, And Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class resource access logs, usage and cost telemetry, quota evaluation, alerting, notification delivery, and admin monitoring pages for Agent Studio.

**Architecture:** Extend the persistence layer with operational event, rollup, quota, alert, and notification tables. Add ingestion, rollup, quota, alert, and notification services, then wire them into existing session, portal, resource, RBAC, and org-sync paths. Finish by exposing admin APIs and admin-console pages for overview, rankings, logs, quota rules, alert rules, alert events, and notification delivery records.

**Tech Stack:** Prisma ORM, PostgreSQL, Express, TypeScript, React, Vite, assistant-ui, Vitest, Supertest.

---

## File Structure

### Backend

- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/20260330110000_add_audit_monitoring_quota/migration.sql`
- Create: `agent-api/src/persistence/resource-access-log-repository.ts`
- Create: `agent-api/src/persistence/resource-access-log-repository.test.ts`
- Create: `agent-api/src/persistence/usage-event-repository.ts`
- Create: `agent-api/src/persistence/usage-event-repository.test.ts`
- Create: `agent-api/src/persistence/usage-rollup-repository.ts`
- Create: `agent-api/src/persistence/usage-rollup-repository.test.ts`
- Create: `agent-api/src/persistence/cost-profile-repository.ts`
- Create: `agent-api/src/persistence/cost-profile-repository.test.ts`
- Create: `agent-api/src/persistence/quota-policy-repository.ts`
- Create: `agent-api/src/persistence/quota-policy-repository.test.ts`
- Create: `agent-api/src/persistence/alert-rule-repository.ts`
- Create: `agent-api/src/persistence/alert-rule-repository.test.ts`
- Create: `agent-api/src/persistence/alert-event-repository.ts`
- Create: `agent-api/src/persistence/alert-event-repository.test.ts`
- Create: `agent-api/src/persistence/notification-record-repository.ts`
- Create: `agent-api/src/persistence/notification-record-repository.test.ts`
- Create: `agent-api/src/operations/resource-access-log-service.ts`
- Create: `agent-api/src/operations/resource-access-log-service.test.ts`
- Create: `agent-api/src/operations/usage-ingestion-service.ts`
- Create: `agent-api/src/operations/usage-ingestion-service.test.ts`
- Create: `agent-api/src/operations/usage-rollup-service.ts`
- Create: `agent-api/src/operations/usage-rollup-service.test.ts`
- Create: `agent-api/src/operations/quota-evaluation-service.ts`
- Create: `agent-api/src/operations/quota-evaluation-service.test.ts`
- Create: `agent-api/src/operations/alert-evaluation-service.ts`
- Create: `agent-api/src/operations/alert-evaluation-service.test.ts`
- Create: `agent-api/src/operations/notification-dispatch-service.ts`
- Create: `agent-api/src/operations/notification-dispatch-service.test.ts`
- Create: `agent-api/src/admin/monitoring-router.ts`
- Create: `agent-api/src/admin/monitoring-router.test.ts`
- Modify: `agent-api/src/admin/router.ts`
- Modify: `agent-api/src/admin/router.test.ts`
- Modify: `agent-api/src/index.ts`
- Modify: `agent-api/src/app-routes.ts`
- Modify: `agent-api/src/resources/runtime-knowledge-set-service.ts`
- Modify: `agent-api/src/resources/admin-router.ts`
- Modify: `agent-api/src/resources/portal-router.ts`
- Modify: `agent-api/src/live-runtime-session.ts`
- Modify: `agent-api/src/portal/router.ts`
- Modify: `agent-api/src/auth/permission-guard.ts`
- Modify: `agent-api/src/org-sync/org-sync-service.ts`

### Frontend

- Create: `agent-ui/src/features/monitoring/types.ts`
- Create: `agent-ui/src/features/monitoring/api.ts`
- Create: `agent-ui/src/features/monitoring/api.test.ts`
- Create: `agent-ui/src/features/monitoring/MonitoringOverviewView.tsx`
- Create: `agent-ui/src/features/monitoring/MonitoringOverviewView.test.tsx`
- Create: `agent-ui/src/features/monitoring/UsageRankingsView.tsx`
- Create: `agent-ui/src/features/monitoring/UsageRankingsView.test.tsx`
- Create: `agent-ui/src/features/monitoring/ResourceAccessLogView.tsx`
- Create: `agent-ui/src/features/monitoring/ResourceAccessLogView.test.tsx`
- Create: `agent-ui/src/features/monitoring/QuotaRulesView.tsx`
- Create: `agent-ui/src/features/monitoring/QuotaRulesView.test.tsx`
- Create: `agent-ui/src/features/monitoring/AlertCenterView.tsx`
- Create: `agent-ui/src/features/monitoring/AlertCenterView.test.tsx`
- Create: `agent-ui/src/features/monitoring/CostProfilesView.tsx`
- Create: `agent-ui/src/features/monitoring/CostProfilesView.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/styles.css`

### Docs

- Reference: `docs/superpowers/specs/2026-03-30-agent-studio-audit-monitoring-quota-design.md`

## Notes

- Keep RBAC `admin_audit_logs` separate from operational logs.
- Use platform-level and department-level quota scopes only in this phase.
- Use soft-blocking only for new sessions and new controlled costly actions.
- Preserve existing running sessions; do not terminate them when quotas are exceeded.
- Reuse DingTalk delivery primitives for alert notifications instead of introducing a second notification auth stack.

### Task 1: Extend Prisma schema for operational events, rollups, quota rules, alerts, and notification records

**Files:**
- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/20260330110000_add_audit_monitoring_quota/migration.sql`

- [ ] **Step 1: Run a failing schema diff check for the new operational tables**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE "(resource_access_logs|usage_events|usage_daily_rollups|cost_profiles|quota_policies|alert_rules|alert_events|notification_records)"'
```

Expected: FAIL because these tables do not yet exist in the schema.

- [ ] **Step 2: Add Prisma models for the operational governance tables**

Add models like:

```prisma
model ResourceAccessLog {
  id                   String   @id @default(cuid())
  organizationId       String?  @map("organization_id")
  userId               String?  @map("user_id")
  departmentIdSnapshot String?  @map("department_id_snapshot")
  threadId             String?  @map("thread_id")
  sessionId            String?  @map("session_id")
  resourceType         String   @map("resource_type")
  resourceId           String   @map("resource_id")
  actionType           String   @map("action_type")
  resultStatus         String   @map("result_status")
  metadata             Json?
  createdAt            DateTime @default(now()) @map("created_at")

  @@index([userId, createdAt])
  @@index([resourceType, resourceId, createdAt])
  @@index([resultStatus, createdAt])
  @@map("resource_access_logs")
}

model UsageEvent {
  id                   String   @id @default(cuid())
  organizationId       String?  @map("organization_id")
  userId               String?  @map("user_id")
  departmentIdSnapshot String?  @map("department_id_snapshot")
  threadId             String?  @map("thread_id")
  sessionId            String?  @map("session_id")
  model                String
  featureType          String   @map("feature_type")
  inputTokens          Int      @default(0) @map("input_tokens")
  cachedInputTokens    Int      @default(0) @map("cached_input_tokens")
  outputTokens         Int      @default(0) @map("output_tokens")
  estimatedCost        Decimal  @default(0) @db.Decimal(18, 6) @map("estimated_cost")
  internalCost         Decimal  @default(0) @db.Decimal(18, 6) @map("internal_cost")
  resultStatus         String   @map("result_status")
  metadata             Json?
  createdAt            DateTime @default(now()) @map("created_at")

  @@index([userId, createdAt])
  @@index([departmentIdSnapshot, createdAt])
  @@index([model, createdAt])
  @@index([featureType, createdAt])
  @@map("usage_events")
}
```

Also add:

- `UsageDailyRollup`
- `CostProfile`
- `QuotaPolicy`
- `AlertRule`
- `AlertEvent`
- `NotificationRecord`

Use string enums at the application layer in this phase instead of introducing new PostgreSQL enum types unless an existing file already uses them.

- [ ] **Step 3: Add the SQL migration with indexes for dashboard and rule evaluation paths**

Create `agent-api/prisma/migrations/20260330110000_add_audit_monitoring_quota/migration.sql` with concrete DDL for the eight new tables and indexes covering:

- time-based usage scans
- department and user filtering
- model and feature filtering
- open alert lookups
- notification delivery status lookups

Do not rewrite or drop existing RBAC audit tables.

- [ ] **Step 4: Run Prisma generation and verify the new table diff**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm run prisma:generate
npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE "(resource_access_logs|usage_events|usage_daily_rollups|cost_profiles|quota_policies|alert_rules|alert_events|notification_records)"'
```

Expected: PASS with the new table names present.

- [ ] **Step 5: Commit the schema work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/schema.prisma /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/migrations/20260330110000_add_audit_monitoring_quota
git commit -m "feat: add audit monitoring schema"
```

### Task 2: Add repositories and ingestion services for resource access logs and usage events

**Files:**
- Create: `agent-api/src/persistence/resource-access-log-repository.ts`
- Create: `agent-api/src/persistence/resource-access-log-repository.test.ts`
- Create: `agent-api/src/persistence/usage-event-repository.ts`
- Create: `agent-api/src/persistence/usage-event-repository.test.ts`
- Create: `agent-api/src/persistence/cost-profile-repository.ts`
- Create: `agent-api/src/persistence/cost-profile-repository.test.ts`
- Create: `agent-api/src/operations/resource-access-log-service.ts`
- Create: `agent-api/src/operations/resource-access-log-service.test.ts`
- Create: `agent-api/src/operations/usage-ingestion-service.ts`
- Create: `agent-api/src/operations/usage-ingestion-service.test.ts`
- Modify: `agent-api/src/resources/runtime-knowledge-set-service.ts`
- Modify: `agent-api/src/resources/admin-router.ts`
- Modify: `agent-api/src/resources/portal-router.ts`
- Modify: `agent-api/src/live-runtime-session.ts`
- Modify: `agent-api/src/portal/router.ts`
- Modify: `agent-api/src/auth/permission-guard.ts`
- Modify: `agent-api/src/org-sync/org-sync-service.ts`

- [ ] **Step 1: Write failing repository and ingestion tests**

Add tests proving:

```ts
it("records a resource access log with session and thread context", async () => {
  const repository = new ResourceAccessLogRepository(new FakeOperationsDb());
  const created = await repository.create({
    userId: "user-1",
    departmentIdSnapshot: "dept-rd",
    threadId: "thread-1",
    sessionId: "session-1",
    resourceType: "knowledge_set",
    resourceId: "ks-faq",
    actionType: "mount",
    resultStatus: "success"
  });

  expect(created.resourceType).toBe("knowledge_set");
  expect(created.threadId).toBe("thread-1");
});

it("calculates estimated and internal cost from a model cost profile", async () => {
  const service = new UsageIngestionService({
    usageEvents: new UsageEventRepository(new FakeOperationsDb()),
    costProfiles: new CostProfileRepository(new FakeOperationsDb())
  });

  const event = await service.record({
    model: "gpt-5.4",
    featureType: "chat",
    inputTokens: 1000,
    cachedInputTokens: 0,
    outputTokens: 500
  });

  expect(event.estimatedCost).toBeGreaterThan(0);
  expect(event.internalCost).toBeGreaterThanOrEqual(event.estimatedCost);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- resource-access-log-repository.test.ts usage-event-repository.test.ts cost-profile-repository.test.ts resource-access-log-service.test.ts usage-ingestion-service.test.ts
```

Expected: FAIL because the repositories and services do not exist yet.

- [ ] **Step 3: Implement repositories and ingestion services**

Implement focused APIs like:

```ts
export class ResourceAccessLogRepository {
  async create(input: CreateResourceAccessLogInput): Promise<ResourceAccessLogRecord> {}
  async list(input: { userId?: string; resourceType?: string; resultStatus?: string; take?: number }): Promise<ResourceAccessLogRecord[]> {}
}

export class CostProfileRepository {
  async listActive(): Promise<CostProfileRecord[]> {}
  async upsert(input: UpsertCostProfileInput): Promise<CostProfileRecord> {}
}

export class UsageIngestionService {
  async record(input: RecordUsageInput): Promise<UsageEventRecord> {}
}
```

Rules:

- `UsageIngestionService` must calculate `estimatedCost` and `internalCost`
- if no active cost profile exists for a model, default both costs to `0`
- logging failures in non-critical paths should throw to the caller test layer in this task; later wiring decides whether to swallow or propagate

- [ ] **Step 4: Wire event producers into existing paths**

Update existing flows so they emit the first operational events:

- workspace / knowledge-set mount paths log `mount`
- managed uploads log `upload`
- permission denials log `deny`
- org-sync runs log `sync`
- runtime completion paths ingest `usage_events` from existing usage payloads

Keep each integration minimal and use the new services instead of ad hoc table writes.

- [ ] **Step 5: Run focused tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- resource-access-log-repository.test.ts usage-event-repository.test.ts cost-profile-repository.test.ts resource-access-log-service.test.ts usage-ingestion-service.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit ingestion work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/resource-access-log-repository* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/usage-event-repository* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/cost-profile-repository* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/operations/resource-access-log-service* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/operations/usage-ingestion-service* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/runtime-knowledge-set-service.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/admin-router.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/portal-router.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/live-runtime-session.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/portal/router.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/auth/permission-guard.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/org-sync/org-sync-service.ts
git commit -m "feat: add operational event ingestion"
```

### Task 3: Add rollup generation and quota evaluation with soft-blocking

**Files:**
- Create: `agent-api/src/persistence/usage-rollup-repository.ts`
- Create: `agent-api/src/persistence/usage-rollup-repository.test.ts`
- Create: `agent-api/src/persistence/quota-policy-repository.ts`
- Create: `agent-api/src/persistence/quota-policy-repository.test.ts`
- Create: `agent-api/src/operations/usage-rollup-service.ts`
- Create: `agent-api/src/operations/usage-rollup-service.test.ts`
- Create: `agent-api/src/operations/quota-evaluation-service.ts`
- Create: `agent-api/src/operations/quota-evaluation-service.test.ts`
- Modify: `agent-api/src/index.ts`

- [ ] **Step 1: Write failing rollup and quota tests**

Add tests proving:

```ts
it("rolls raw usage events into daily user and department totals", async () => {
  const service = new UsageRollupService({
    usageEvents: new UsageEventRepository(new FakeOperationsDb()),
    rollups: new UsageRollupRepository(new FakeOperationsDb())
  });

  await service.rebuildDay("2026-03-30");

  expect(await service.listDay("2026-03-30", "department")).toContainEqual(
    expect.objectContaining({ scopeType: "department", scopeId: "dept-rd" })
  );
});

it("applies a department quota override before the platform default", async () => {
  const service = new QuotaEvaluationService({
    rollups: new UsageRollupRepository(new FakeOperationsDb()),
    quotaPolicies: new QuotaPolicyRepository(new FakeOperationsDb())
  });

  const result = await service.evaluateNewSession({
    userId: "user-1",
    departmentId: "dept-rd",
    featureType: "chat",
    model: "gpt-5.4"
  });

  expect(result.decision).toBe("soft_block");
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- usage-rollup-repository.test.ts quota-policy-repository.test.ts usage-rollup-service.test.ts quota-evaluation-service.test.ts
```

Expected: FAIL because the rollup and quota services do not exist yet.

- [ ] **Step 3: Implement repositories and services**

Implement focused APIs like:

```ts
export class UsageRollupService {
  async rebuildDay(isoDate: string): Promise<void> {}
}

export class QuotaEvaluationService {
  async evaluateNewSession(input: EvaluateQuotaInput): Promise<{ decision: "allow" | "soft_block"; reason?: string }> {}
}
```

Rules:

- rollups must be idempotent for a given day and scope
- quota evaluation must resolve department rule first, then platform rule
- only `soft_block` or `allow` exist in this phase

- [ ] **Step 4: Wire quota checks into new-session and new-costly-action paths**

Update backend entry points so quota evaluation runs before:

- new session creation
- new thread creation when it initiates execution
- other controlled new costly paths already exposed in this codebase

Do not terminate already-running sessions.

- [ ] **Step 5: Run focused tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- usage-rollup-repository.test.ts quota-policy-repository.test.ts usage-rollup-service.test.ts quota-evaluation-service.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit rollup and quota work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/usage-rollup-repository* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/quota-policy-repository* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/operations/usage-rollup-service* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/operations/quota-evaluation-service* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts
git commit -m "feat: add quota evaluation and usage rollups"
```

### Task 4: Add alert rules, alert evaluation, and notification delivery

**Files:**
- Create: `agent-api/src/persistence/alert-rule-repository.ts`
- Create: `agent-api/src/persistence/alert-rule-repository.test.ts`
- Create: `agent-api/src/persistence/alert-event-repository.ts`
- Create: `agent-api/src/persistence/alert-event-repository.test.ts`
- Create: `agent-api/src/persistence/notification-record-repository.ts`
- Create: `agent-api/src/persistence/notification-record-repository.test.ts`
- Create: `agent-api/src/operations/alert-evaluation-service.ts`
- Create: `agent-api/src/operations/alert-evaluation-service.test.ts`
- Create: `agent-api/src/operations/notification-dispatch-service.ts`
- Create: `agent-api/src/operations/notification-dispatch-service.test.ts`
- Modify: `agent-api/src/index.ts`

- [ ] **Step 1: Write failing alert and notification tests**

Add tests proving:

```ts
it("creates a quota alert event when a soft-block threshold is exceeded", async () => {
  const service = new AlertEvaluationService({
    alertRules: new AlertRuleRepository(new FakeOperationsDb()),
    alertEvents: new AlertEventRepository(new FakeOperationsDb())
  });

  const created = await service.evaluateQuotaResult({
    scopeType: "department",
    scopeId: "dept-rd",
    metricType: "internal_cost",
    triggeredValue: "120.00",
    thresholdValue: "100.00"
  });

  expect(created).toEqual(
    expect.objectContaining({ severity: "warning", status: "open" })
  );
});

it("persists a DingTalk notification delivery record even when sending fails", async () => {
  const service = new NotificationDispatchService({
    notifications: new NotificationRecordRepository(new FakeOperationsDb()),
    dingtalk: failingNotifier
  });

  await service.dispatchAlert(alertEvent);

  expect(await notifications.list()).toContainEqual(
    expect.objectContaining({ channelType: "dingtalk", status: "failed" })
  );
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- alert-rule-repository.test.ts alert-event-repository.test.ts notification-record-repository.test.ts alert-evaluation-service.test.ts notification-dispatch-service.test.ts
```

Expected: FAIL because the alert and notification layer does not exist yet.

- [ ] **Step 3: Implement repositories and services**

Implement focused APIs like:

```ts
export class AlertEvaluationService {
  async evaluateQuotaResult(input: EvaluateQuotaAlertInput): Promise<AlertEventRecord | undefined> {}
  async evaluateSecurityEvent(input: EvaluateSecurityEventInput): Promise<AlertEventRecord | undefined> {}
}

export class NotificationDispatchService {
  async dispatchAlert(event: AlertEventRecord): Promise<void> {}
}
```

Rules:

- notification failure must not roll back the alert event
- channels supported in this phase are `in_app` and `dingtalk`
- security alerts should be triggered by denied resource access and repeated permission denial patterns exposed by current event producers

- [ ] **Step 4: Wire alert evaluation after quota and security events**

Update service wiring so:

- quota soft-block results evaluate matching alert rules
- denied access events feed security alert evaluation
- resulting alert events trigger notification dispatch

- [ ] **Step 5: Run focused tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- alert-rule-repository.test.ts alert-event-repository.test.ts notification-record-repository.test.ts alert-evaluation-service.test.ts notification-dispatch-service.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit alerting work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/alert-rule-repository* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/alert-event-repository* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/notification-record-repository* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/operations/alert-evaluation-service* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/operations/notification-dispatch-service* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts
git commit -m "feat: add alert evaluation and notifications"
```

### Task 5: Add admin monitoring, quota, and alert APIs

**Files:**
- Create: `agent-api/src/admin/monitoring-router.ts`
- Create: `agent-api/src/admin/monitoring-router.test.ts`
- Modify: `agent-api/src/admin/router.ts`
- Modify: `agent-api/src/admin/router.test.ts`
- Modify: `agent-api/src/app-routes.ts`
- Modify: `agent-api/src/index.ts`

- [ ] **Step 1: Write failing monitoring API tests**

Add tests proving:

```ts
it("returns monitoring overview totals and trend points", async () => {
  const response = await request(app).get("/api/admin/monitoring/overview");
  expect(response.status).toBe(200);
  expect(response.body.overview.totalEstimatedCost).toBeDefined();
  expect(response.body.trends.length).toBeGreaterThan(0);
});

it("updates a department quota override", async () => {
  const response = await request(app)
    .post("/api/admin/quota-policies")
    .send({
      scopeType: "department",
      scopeId: "dept-rd",
      featureType: "chat",
      metricType: "internal_cost",
      thresholdValue: "100.00",
      enforcementMode: "soft_block"
    });

  expect(response.status).toBe(201);
});

it("lists alert events and notification records", async () => {
  const response = await request(app).get("/api/admin/alert-events");
  expect(response.status).toBe(200);
  expect(Array.isArray(response.body.alertEvents)).toBe(true);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- monitoring-router.test.ts admin/router.test.ts
```

Expected: FAIL because the monitoring API does not exist yet.

- [ ] **Step 3: Implement admin monitoring and policy routes**

Add routes:

- `GET /api/admin/monitoring/overview`
- `GET /api/admin/monitoring/rankings`
- `GET /api/admin/monitoring/trends`
- `GET /api/admin/monitoring/resource-access-logs`
- `GET /api/admin/monitoring/usage-events`
- `GET /api/admin/quota-policies`
- `POST /api/admin/quota-policies`
- `PATCH /api/admin/quota-policies/:policyId`
- `GET /api/admin/cost-profiles`
- `POST /api/admin/cost-profiles`
- `PATCH /api/admin/cost-profiles/:profileId`
- `GET /api/admin/alert-rules`
- `POST /api/admin/alert-rules`
- `PATCH /api/admin/alert-rules/:ruleId`
- `GET /api/admin/alert-events`
- `POST /api/admin/alert-events/:eventId/acknowledge`
- `GET /api/admin/notification-records`

Protect them with explicit permissions such as:

- `audit.read`
- `monitoring.read`
- `quota.read`
- `quota.write`
- `alert.read`
- `alert.write`

Seed any new built-in permissions in the RBAC seed layer as part of this task if needed.

- [ ] **Step 4: Wire the router into the admin surface**

Update `index.ts`, `app-routes.ts`, and `admin/router.ts` so:

- the monitoring router is mounted under `/api/admin`
- the old admin overview continues to work
- new endpoints coexist cleanly with org-sync and RBAC routes

- [ ] **Step 5: Run focused tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- monitoring-router.test.ts admin/router.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit monitoring API work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin/monitoring-router* /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin/router.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin/router.test.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/app-routes.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts
git commit -m "feat: add monitoring admin api"
```

### Task 6: Add admin-console monitoring, quota, cost, and alert views

**Files:**
- Create: `agent-ui/src/features/monitoring/types.ts`
- Create: `agent-ui/src/features/monitoring/api.ts`
- Create: `agent-ui/src/features/monitoring/api.test.ts`
- Create: `agent-ui/src/features/monitoring/MonitoringOverviewView.tsx`
- Create: `agent-ui/src/features/monitoring/MonitoringOverviewView.test.tsx`
- Create: `agent-ui/src/features/monitoring/UsageRankingsView.tsx`
- Create: `agent-ui/src/features/monitoring/UsageRankingsView.test.tsx`
- Create: `agent-ui/src/features/monitoring/ResourceAccessLogView.tsx`
- Create: `agent-ui/src/features/monitoring/ResourceAccessLogView.test.tsx`
- Create: `agent-ui/src/features/monitoring/QuotaRulesView.tsx`
- Create: `agent-ui/src/features/monitoring/QuotaRulesView.test.tsx`
- Create: `agent-ui/src/features/monitoring/AlertCenterView.tsx`
- Create: `agent-ui/src/features/monitoring/AlertCenterView.test.tsx`
- Create: `agent-ui/src/features/monitoring/CostProfilesView.tsx`
- Create: `agent-ui/src/features/monitoring/CostProfilesView.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing admin UI tests**

Add tests proving:

```tsx
it("navigates from the admin shell into the monitoring view", async () => {
  render(<AdminShell />);
  fireEvent.click(screen.getByRole("tab", { name: "审计监控" }));
  expect(await screen.findByText("平台总览")).toBeTruthy();
});

it("saves a department quota override", async () => {
  render(<QuotaRulesView />);
  fireEvent.change(screen.getByLabelText("部门范围"), { target: { value: "dept-rd" } });
  fireEvent.click(screen.getByRole("button", { name: "保存配额规则" }));
  expect(mockCreateQuotaPolicy).toHaveBeenCalled();
});

it("renders alert rows and notification delivery states", async () => {
  render(<AlertCenterView />);
  expect(await screen.findByText("critical")).toBeTruthy();
  expect(screen.getByText("dingtalk")).toBeTruthy();
});
```

- [ ] **Step 2: Run focused frontend tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/monitoring/api.test.ts src/features/monitoring/MonitoringOverviewView.test.tsx src/features/monitoring/UsageRankingsView.test.tsx src/features/monitoring/ResourceAccessLogView.test.tsx src/features/monitoring/QuotaRulesView.test.tsx src/features/monitoring/AlertCenterView.test.tsx src/features/monitoring/CostProfilesView.test.tsx src/features/admin/AdminShell.test.tsx
```

Expected: FAIL because the monitoring feature files do not exist yet.

- [ ] **Step 3: Implement typed API helpers and focused monitoring components**

Add typed frontend helpers such as:

```ts
export async function fetchMonitoringOverview(): Promise<MonitoringOverviewResponse> {}
export async function fetchUsageRankings(): Promise<UsageRankingsResponse> {}
export async function fetchResourceAccessLogs(): Promise<ResourceAccessLogResponse> {}
export async function fetchQuotaPolicies(): Promise<QuotaPolicyListResponse> {}
export async function createQuotaPolicy(input: CreateQuotaPolicyInput): Promise<QuotaPolicyRecord> {}
export async function fetchAlertEvents(): Promise<AlertEventListResponse> {}
export async function fetchNotificationRecords(): Promise<NotificationRecordListResponse> {}
export async function fetchCostProfiles(): Promise<CostProfileListResponse> {}
```

Build components with focused responsibilities:

- `MonitoringOverviewView` for totals and trend sections
- `UsageRankingsView` for user / department / model / feature rankings
- `ResourceAccessLogView` for access events
- `QuotaRulesView` for platform and department quota rules
- `AlertCenterView` for alert events and delivery status
- `CostProfilesView` for model pricing and multipliers

- [ ] **Step 4: Integrate the monitoring feature into the admin shell**

Update the admin shell and navigation so the new sections are discoverable without disturbing existing Users, RBAC, and Org Sync flows.

- [ ] **Step 5: Run focused frontend tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/monitoring/api.test.ts src/features/monitoring/MonitoringOverviewView.test.tsx src/features/monitoring/UsageRankingsView.test.tsx src/features/monitoring/ResourceAccessLogView.test.tsx src/features/monitoring/QuotaRulesView.test.tsx src/features/monitoring/AlertCenterView.test.tsx src/features/monitoring/CostProfilesView.test.tsx src/features/admin/AdminShell.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit monitoring frontend work**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/monitoring /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css
git commit -m "feat: add monitoring admin console"
```

### Task 7: Run end-to-end verification and fix any integration drift

**Files:**
- Modify: only files required by verification failures

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

- [ ] **Step 3: Run focused compatibility checks**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- monitoring-router.test.ts quota-evaluation-service.test.ts notification-dispatch-service.test.ts admin/router.test.ts
```

Expected: PASS, confirming:

- quota rules soft-block new actions only
- department overrides beat platform defaults
- alert delivery writes notification records
- existing admin overview behavior still works

- [ ] **Step 4: Commit verification-driven fixes**

```bash
git add -A
git commit -m "fix: align monitoring verification issues"
```

Only do this step if verification requires code fixes.
