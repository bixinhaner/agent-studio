# Agent Studio System Settings Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-facing System Settings Center for safe platform-level defaults and hard safety limits, with draft/published semantics and explicit publish behavior.

**Architecture:** Add versioned system settings persistence in the backend, expose admin APIs for reading/updating draft and publishing versions, clamp runtime/capability behavior against published hard limits, and add a new admin UI for editing draft settings and publishing them.

**Tech Stack:** Express, Prisma, Zod, React, TypeScript, Vitest, existing admin shell patterns, existing RBAC/admin audit log plumbing.

---

## File Structure

### Backend
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/types.ts`
  - shared DTOs and zod schemas for draft/published payloads
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/repository.ts`
  - versioned persistence for draft and published settings
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/repository.test.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/service.ts`
  - orchestration for read draft/published, update draft, publish, and clamp helpers
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/service.test.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/router.ts`
  - `/api/admin/system-settings`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/router.test.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/app-routes.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/config.ts`
  - only where runtime fallback/default bridging is required
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin/router.ts`
  - if needed to mount router through common admin chain
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/rbac/seed-system-rbac.ts`
  - add `system_settings.read/write/publish`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/auth/permission-guard.ts`
  - use new permission points where needed
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin/admin-audit-log-service.ts`
  - or existing audit path used by admin mutations
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/portal/runtime-option-service.ts`
  - clamp runtime options against published safety settings
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/mode-admin-router.ts`
  - clamp run-profile writes against published safety settings
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/schema.prisma`
  - add versioned settings tables
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/migrations/20260330210000_add_system_settings_versions/migration.sql`

### Frontend
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/api.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/api.test.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/types.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/SystemSettingsShell.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/SystemSettingsShell.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/BrandingSettingsView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/ModelDefaultsView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/RetentionUploadView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/SafetySettingsView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/OrganizationDefaultsView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/PublishHistoryView.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/types.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css`

### References
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/superpowers/specs/2026-03-30-agent-studio-system-settings-center-design.md`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/ResourceCenterShell.tsx`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/capability-center/CapabilityCenterShell.tsx`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationCenterShell.tsx`

---

### Task 1: Add Versioned System Settings Persistence

**Files:**
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/schema.prisma`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/migrations/20260330210000_add_system_settings_versions/migration.sql`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/types.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/repository.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/repository.test.ts`

- [ ] **Step 1: Write failing repository tests for draft/published version flow**

```ts
it("creates an initial draft and publishes it without mutating prior versions", async () => {
  const repo = createSystemSettingsRepositoryDouble();
  const firstDraft = await repo.getOrCreateDraft();
  const updated = await repo.saveDraft({ ...firstDraft.payload, branding: { platformName: "Agent Studio" } });
  const published = await repo.publishDraft({ publishedByUserId: "admin-1" });

  expect(published.status).toBe("published");
  expect(published.publishedByUserId).toBe("admin-1");
  expect(updated.id).not.toBe(published.id);
});
```

- [ ] **Step 2: Run repository tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/system-settings/repository.test.ts
```

Expected:
- FAIL because repository and schema do not exist yet

- [ ] **Step 3: Add schema and repository implementation**

Core expectations:
- one current draft version
- one current published version
- publish clones draft into a new published version or updates status with preserved history semantics
- versions store full JSON payload and metadata

- [ ] **Step 4: Run Prisma generate and repository tests**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm run prisma:generate
npm test -- src/system-settings/repository.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add agent-api/prisma/schema.prisma \
  agent-api/prisma/migrations \
  agent-api/src/system-settings/types.ts \
  agent-api/src/system-settings/repository.ts \
  agent-api/src/system-settings/repository.test.ts
git commit -m "feat: add system settings persistence"
```

### Task 2: Add System Settings Service and Admin API

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/service.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/service.test.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/router.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/system-settings/router.test.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/app-routes.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/rbac/seed-system-rbac.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin/router.ts`

- [ ] **Step 1: Write failing API tests for read, save draft, publish**

```ts
it("returns draft and published settings to authorized admins", async () => {
  const response = await request(app).get("/api/admin/system-settings");
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty("draft");
  expect(response.body).toHaveProperty("published");
});

it("publishes the current draft and records publish metadata", async () => {
  const response = await request(app).post("/api/admin/system-settings/publish").send({});
  expect(response.status).toBe(200);
  expect(response.body.publishedMeta.publishedByUserId).toBe("admin-1");
});
```

- [ ] **Step 2: Run targeted API tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/system-settings/router.test.ts src/system-settings/service.test.ts
```

Expected:
- FAIL because service/router do not exist yet

- [ ] **Step 3: Implement service and router**

Requirements:
- validate payloads
- support draft reads/writes and publish
- write admin audit events on draft update and publish
- enforce `system_settings.read`, `system_settings.write`, `system_settings.publish`

- [ ] **Step 4: Run targeted tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/system-settings/router.test.ts src/system-settings/service.test.ts src/admin/router.test.ts src/rbac/seed-system-rbac.test.ts
npm run build
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add agent-api/src/system-settings \
  agent-api/src/app-routes.ts \
  agent-api/src/admin/router.ts \
  agent-api/src/rbac/seed-system-rbac.ts
git commit -m "feat: add system settings admin api"
```

### Task 3: Clamp Runtime and Capability Behavior Against Published Settings

**Files:**
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/portal/runtime-option-service.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/mode-admin-router.ts`
- Modify: related tests only as needed

- [ ] **Step 1: Write failing tests for platform hard-limit clamping**

```ts
it("removes danger-full-access from runtime options when platform safety disables it", async () => {
  const result = await service.resolveOptionsForUser(...);
  expect(result.runtimeProfiles.every((item) => item.sandboxMode !== "danger-full-access")).toBe(true);
});

it("rejects run profile writes that exceed published platform hard limits", async () => {
  const response = await request(app)
    .patch("/api/admin/run-profiles/profile-1")
    .send({ sandboxMode: "danger-full-access" });
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/portal/runtime-option-service.test.ts src/resources/mode-admin-router.test.ts
```

Expected:
- FAIL until clamping is implemented

- [ ] **Step 3: Implement hard-limit clamping and validation**

Rules:
- published system settings are the source of truth
- new requests only
- do not mutate running sessions
- run profiles can narrow within boundaries but cannot exceed them

- [ ] **Step 4: Run targeted tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/portal/runtime-option-service.test.ts src/resources/mode-admin-router.test.ts src/system-settings/service.test.ts
npm run build
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add agent-api/src/portal/runtime-option-service.ts \
  agent-api/src/resources/mode-admin-router.ts \
  agent-api/src/portal/runtime-option-service.test.ts \
  agent-api/src/resources/mode-admin-router.test.ts
git commit -m "feat: enforce published system settings limits"
```

### Task 4: Build the Admin System Settings UI

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/api.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/api.test.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/types.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/SystemSettingsShell.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/SystemSettingsShell.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/BrandingSettingsView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/ModelDefaultsView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/RetentionUploadView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/SafetySettingsView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/OrganizationDefaultsView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/system-settings/PublishHistoryView.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/types.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css`

- [ ] **Step 1: Write failing frontend tests for settings shell and publish flow**

```tsx
it("renders system settings in the admin shell and switches setting sections", async () => {
  render(<AdminShell />);
  await userEvent.click(screen.getByRole("tab", { name: "系统设置" }));
  expect(await screen.findByText("模型默认值")).toBeTruthy();
});

it("saves draft settings and publishes them", async () => {
  render(<SystemSettingsShell />);
  await userEvent.click(await screen.findByRole("button", { name: "保存草稿" }));
  await userEvent.click(screen.getByRole("button", { name: "发布设置" }));
  expect(await screen.findByText(/最近发布/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run targeted frontend tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/system-settings/api.test.ts src/features/system-settings/SystemSettingsShell.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
```

Expected:
- FAIL because system-settings module does not exist yet

- [ ] **Step 3: Implement the settings shell and sections**

Requirements:
- load draft + published
- edit draft only
- save draft
- publish explicitly
- show published metadata
- keep times rendered in local timezone

- [ ] **Step 4: Run targeted frontend tests and build**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/system-settings/api.test.ts src/features/system-settings/SystemSettingsShell.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
npm run build
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/features/system-settings \
  agent-ui/src/features/admin/AdminNav.tsx \
  agent-ui/src/features/admin/AdminShell.tsx \
  agent-ui/src/features/admin/types.ts \
  agent-ui/src/styles.css
git commit -m "feat: add system settings admin console"
```

### Task 5: Final Verification and Regression Coverage

**Files:**
- Modify: any affected failing tests from previous tasks only
- Verify: backend and frontend full suite

- [ ] **Step 1: Run targeted backend regression suite for settings and runtime clamping**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/system-settings/router.test.ts src/system-settings/service.test.ts src/portal/runtime-option-service.test.ts src/resources/mode-admin-router.test.ts src/admin/router.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Run targeted frontend regression suite for settings shell and admin wiring**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/system-settings/api.test.ts src/features/system-settings/SystemSettingsShell.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
```

Expected:
- PASS

- [ ] **Step 3: Run full verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test && npm run build && npm run prisma:generate
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test && npm run build
```

Expected:
- backend tests: PASS
- backend build: PASS
- Prisma generate: PASS
- frontend tests: PASS
- frontend build: PASS
- non-blocking Vite chunk-size warning may remain if unchanged from prior baseline

- [ ] **Step 4: Commit any final verification fixes**

```bash
git add agent-api agent-ui
git commit -m "fix: finalize system settings verification issues"
```

---

## Spec Coverage Check

Covered spec sections:
- versioned draft/published settings model: Tasks 1-2
- safe platform-level settings scope: Tasks 1-4
- publish semantics: Tasks 1-4
- hard-limit enforcement over run profiles/runtime: Task 3
- admin UI with publish history: Task 4
- admin audit on update/publish: Task 2

No uncovered core requirements remain from the spec.

## Self-Review

- Placeholder scan completed: no `TBD`, `TODO`, or unresolved implementation placeholders remain.
- Scope check passed: deployment-only filesystem/path settings remain out of scope.
- Boundary check passed: provider credentials and validation remain in Integration Center, not System Settings Center.
