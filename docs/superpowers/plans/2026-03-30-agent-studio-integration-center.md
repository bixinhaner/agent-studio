# Agent Studio Integration Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified admin-facing Integration Center for DingTalk, Zendesk, and OpenAI/Codex, including instance management, secure configuration editing, validation history, bindings, and authorization.

**Architecture:** Introduce a unified `integration instance` persistence layer and admin API under `/api/admin/integrations`, then migrate Zendesk onto that model, add DingTalk and OpenAI/Codex adapters, and finally replace the standalone Zendesk admin panel with a new Integration Center shell in the admin console. Reuse existing RBAC, `resource_policies`, admin audit logging, and service-specific logic instead of inventing parallel systems.

**Tech Stack:** Express, Prisma, Zod, React, TypeScript, Vitest, existing admin shell patterns, existing Zendesk and DingTalk services.

---

## File Structure

### Backend
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/integration-instance-repository.ts`
  - unified CRUD for integration instances, configs, secrets, validation history, bindings
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/integration-instance-repository.test.ts`
  - repository coverage for singleton enforcement, secret state, validation history, bindings
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/types.ts`
  - shared DTOs and Zod schemas for admin contract
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/service.ts`
  - orchestration layer for listing, reading, saving, validating, and binding integration instances
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/service.test.ts`
  - service-level behavior for each adapter type and authorization edge cases
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/router.ts`
  - unified admin routes under `/api/admin/integrations`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/router.test.ts`
  - route contract tests
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/dingtalk-adapter.ts`
  - DingTalk config mapping and validation
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/openai-codex-adapter.ts`
  - provider config mapping and validation
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/zendesk/service.ts`
  - support instance-backed config reads/writes while preserving runtime behavior
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/zendesk/router.ts`
  - keep only compatibility behavior needed during migration or reduce to delegated center routes
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/integration-repository.ts`
  - keep backward-compatible helpers or narrow to legacy bridge during migration
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts`
  - wire Integration Center router and adapter dependencies
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/app-routes.ts`
  - mount new admin router without breaking existing auth/admin order
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/config.ts`
  - add OpenAI/Codex provider config fields only if adapter validation needs them
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/schema.prisma`
  - add integration instance tables and relations
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/migrations/<timestamp>_add_integration_center_tables/migration.sql`
  - migration for instance/config/secret/history/binding tables

### Frontend
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/api.ts`
  - typed API client for list/detail/save/validate/bind/policy flows
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/api.test.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/types.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationCenterShell.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationCenterShell.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/DingTalkIntegrationView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/DingTalkIntegrationView.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/ZendeskIntegrationView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/ZendeskIntegrationView.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/OpenAICodexIntegrationView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/OpenAICodexIntegrationView.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationValidationHistory.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationPolicyEditor.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationBindingsEditor.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminNav.tsx`
  - add `集成中心` tab
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminShell.tsx`
  - render Integration Center shell
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/types.ts`
  - add new admin section id
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/zendesk/ZendeskIntegrationPanel.tsx`
  - remove old primary-admin usage or reduce to compatibility wrapper if needed
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css`
  - shared layout and form styles for Integration Center

### References
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/superpowers/specs/2026-03-30-agent-studio-integration-center-design.md`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/ResourceCenterShell.tsx`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/capability-center/CapabilityCenterShell.tsx`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/admin-router.ts`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/mode-admin-router.ts`

---

### Task 1: Add Unified Integration Instance Persistence

**Files:**
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/schema.prisma`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/migrations/<timestamp>_add_integration_center_tables/migration.sql`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/integration-instance-repository.ts`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/integration-instance-repository.test.ts`

- [ ] **Step 1: Write failing repository tests for integration instances, secret state, history, and bindings**

```ts
it("enforces singleton instance types for dingtalk and openai_codex", async () => {
  const repository = createIntegrationInstanceRepositoryDouble();
  await repository.createInstance({ type: "dingtalk", slug: "corp-main", name: "Corp Main" });
  await expect(
    repository.createInstance({ type: "dingtalk", slug: "corp-2", name: "Corp 2" })
  ).rejects.toThrow(/single-instance/i);
});

it("stores secret rotation metadata without exposing secret values in summary reads", async () => {
  const repository = createIntegrationInstanceRepositoryDouble();
  const instance = await repository.createInstance({ type: "openai_codex", slug: "primary", name: "Primary" });
  await repository.rotateSecrets(instance.id, {
    payload: { apiKey: "sk-test" },
    rotatedByUserId: "user-1"
  });
  const summary = await repository.getInstance(instance.id);
  expect(summary.secretState.hasSecrets).toBe(true);
  expect(summary.secretState.rotatedByUserId).toBe("user-1");
  expect(JSON.stringify(summary)).not.toContain("sk-test");
});
```

- [ ] **Step 2: Run repository tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/persistence/integration-instance-repository.test.ts
```

Expected:
- FAIL because repository and schema do not exist yet

- [ ] **Step 3: Add Prisma tables and repository implementation**

```prisma
model IntegrationInstance {
  id                String   @id @default(cuid())
  organizationId    String?
  type              String
  slug              String
  name              String
  description       String?
  status            String
  isSystemSingleton Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  configs           IntegrationInstanceConfig[]
  secrets           IntegrationInstanceSecret[]
  validations       IntegrationValidationRun[]
  bindings          IntegrationBindingRecord[]

  @@unique([type, slug])
}
```

```ts
export class IntegrationInstanceRepository {
  async createInstance(input: CreateIntegrationInstanceInput): Promise<IntegrationInstanceRecord> {
    if (SINGLETON_TYPES.has(input.type)) {
      const existing = await this.db.integrationInstance.findFirst({ where: { type: input.type } });
      if (existing) throw new Error(`single-instance integration already exists for ${input.type}`);
    }
    const row = await this.db.integrationInstance.create({
      data: {
        type: input.type,
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? "draft",
        isSystemSingleton: SINGLETON_TYPES.has(input.type)
      }
    });
    return mapInstance(row, null);
  }
}
```

- [ ] **Step 4: Run repository tests and Prisma generate**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm run prisma:generate
npm test -- src/persistence/integration-instance-repository.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add agent-api/prisma/schema.prisma \
  agent-api/prisma/migrations \
  agent-api/src/persistence/integration-instance-repository.ts \
  agent-api/src/persistence/integration-instance-repository.test.ts
git commit -m "feat: add integration instance persistence"
```

### Task 2: Add Unified Integration Center Backend Contract

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/types.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/service.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/service.test.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/router.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/router.test.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/app-routes.ts`

- [ ] **Step 1: Write failing router tests for list/detail/save/validate/history/policies**

```ts
it("lists integration instances by type for admins", async () => {
  const app = createApp();
  const response = await request(app).get("/api/admin/integrations?type=zendesk");
  expect(response.status).toBe(200);
  expect(response.body.items[0]).toMatchObject({ type: "zendesk" });
});

it("updates policies for an integration instance", async () => {
  const app = createApp();
  const response = await request(app)
    .put("/api/admin/integrations/int-zendesk-1/policies")
    .send({ roleAllowIds: ["role-support-admin"], userDenyIds: ["user-9"] });
  expect(response.status).toBe(200);
  expect(response.body.summary.allow.roles).toContain("role-support-admin");
});
```

- [ ] **Step 2: Run router tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/integrations/center/router.test.ts src/integrations/center/service.test.ts
```

Expected:
- FAIL because unified center service/router do not exist yet

- [ ] **Step 3: Implement shared center service and unified admin router**

```ts
router.get("/integrations", requirePermission("integration.read"), async (req, res) => {
  const type = listTypeSchema.parse(req.query).type;
  res.json(await service.listInstances({ currentUserId: req.currentUser.id, type }));
});

router.post("/integrations/:id/validate", requirePermission("integration.write"), async (req, res) => {
  res.json(await service.validateInstance({
    integrationInstanceId: req.params.id,
    triggeredByUserId: req.currentUser.id
  }));
});
```

- [ ] **Step 4: Run targeted backend verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/integrations/center/router.test.ts src/integrations/center/service.test.ts src/admin/router.test.ts
npm run build
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add agent-api/src/integrations/center \
  agent-api/src/index.ts \
  agent-api/src/app-routes.ts
git commit -m "feat: add integration center backend contract"
```

### Task 3: Migrate Zendesk into the Integration Center

**Files:**
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/zendesk/service.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/zendesk/router.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/integration-repository.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/service.ts`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/zendesk/router.test.ts`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/service.test.ts`

- [ ] **Step 1: Write failing migration-compatibility tests for Zendesk settings and multi-instance behavior**

```ts
it("loads Zendesk config from the integration instance model without changing overview semantics", async () => {
  const service = createZendeskServiceForInstance("zendesk-support-main");
  const overview = await service.getOverview();
  expect(overview.settings.zendeskBaseUrl).toBe("https://example.zendesk.com");
  expect(overview.ready).toBe(false);
});

it("allows multiple active zendesk instances in the center summary", async () => {
  const summary = await centerService.listInstances({ type: "zendesk", currentUserId: "admin-1" });
  expect(summary.items.filter((item) => item.status === "active")).toHaveLength(2);
});
```

- [ ] **Step 2: Run compatibility tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/integrations/zendesk/router.test.ts src/integrations/center/service.test.ts
```

Expected:
- FAIL because Zendesk still relies on legacy settings-only flows

- [ ] **Step 3: Bridge Zendesk runtime behavior onto integration instances**

```ts
export class ZendeskSettingsStore {
  async getForInstance(instanceId?: string): Promise<ZendeskIntegrationSettings> {
    const resolved = instanceId ?? DEFAULT_ZENDESK_INSTANCE_ID;
    const config = await this.integrationInstanceRepository.getTypedConfig<ZendeskIntegrationSettings>(resolved);
    return mergeWithZendeskDefaults(config);
  }
}
```

```ts
async getOverviewForInstance(instanceId: string): Promise<ZendeskOverview> {
  const settings = await this.settingsStore.getForInstance(instanceId);
  return buildOverview(settings, await this.validationRepository.listForInstance(instanceId));
}
```

- [ ] **Step 4: Run targeted backend verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/integrations/zendesk/router.test.ts src/integrations/center/service.test.ts src/admin/router.test.ts
npm run build
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add agent-api/src/integrations/zendesk/service.ts \
  agent-api/src/integrations/zendesk/router.ts \
  agent-api/src/persistence/integration-repository.ts \
  agent-api/src/integrations/center/service.ts
git commit -m "feat: migrate zendesk into integration center"
```

### Task 4: Add DingTalk and OpenAI/Codex Integration Adapters

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/dingtalk-adapter.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/openai-codex-adapter.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/config.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/auth/dingtalk.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/codex-runtime.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/service.ts`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/center/service.test.ts`

- [ ] **Step 1: Write failing adapter tests for DingTalk validation and OpenAI/Codex provider validation**

```ts
it("validates dingtalk credentials and records validation history", async () => {
  const result = await centerService.validateInstance({ integrationInstanceId: "int-dingtalk-main", triggeredByUserId: "admin-1" });
  expect(result.status).toBe("success");
  expect(result.summary).toMatch(/dingtalk/i);
});

it("updates platform default model and reasoning effort through openai_codex config", async () => {
  await centerService.updateInstanceConfig({
    integrationInstanceId: "int-openai-main",
    config: { defaultModel: "gpt-5.4-mini", defaultReasoningEffort: "medium" },
    rotatedByUserId: "admin-1"
  });
  const detail = await centerService.getInstanceDetail({ integrationInstanceId: "int-openai-main", currentUserId: "admin-1" });
  expect(detail.config.defaultModel).toBe("gpt-5.4-mini");
});
```

- [ ] **Step 2: Run adapter tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/integrations/center/service.test.ts
```

Expected:
- FAIL because DingTalk and OpenAI/Codex adapters are not implemented yet

- [ ] **Step 3: Implement type-specific adapter logic**

```ts
export class DingTalkIntegrationAdapter {
  async validate(config: DingTalkConfigPayload): Promise<ValidationOutcome> {
    const client = createDingTalkClient(config);
    await client.getAppAccessToken();
    return { status: "success", summary: "DingTalk credential validation succeeded" };
  }
}
```

```ts
export class OpenAICodexIntegrationAdapter {
  async validate(config: OpenAICodexConfigPayload): Promise<ValidationOutcome> {
    const runtime = new CodexRuntime({ baseUrl: config.baseUrl, apiKey: config.apiKey });
    await runtime.validateProvider();
    return { status: "success", summary: "OpenAI/Codex provider validation succeeded" };
  }
}
```

- [ ] **Step 4: Run targeted backend verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/integrations/center/service.test.ts src/auth/dingtalk.test.ts
npm run build
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add agent-api/src/integrations/center/dingtalk-adapter.ts \
  agent-api/src/integrations/center/openai-codex-adapter.ts \
  agent-api/src/config.ts \
  agent-api/src/auth/dingtalk.ts \
  agent-api/src/codex-runtime.ts \
  agent-api/src/integrations/center/service.ts
git commit -m "feat: add dingtalk and openai integration adapters"
```

### Task 5: Build the Admin Integration Center UI and Replace the Zendesk Entry

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/api.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/api.test.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/types.ts`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationCenterShell.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationCenterShell.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/DingTalkIntegrationView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/DingTalkIntegrationView.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/ZendeskIntegrationView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/ZendeskIntegrationView.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/OpenAICodexIntegrationView.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/OpenAICodexIntegrationView.test.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationValidationHistory.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationPolicyEditor.tsx`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/integration-center/IntegrationBindingsEditor.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/types.ts`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/zendesk/ZendeskIntegrationPanel.tsx`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css`

- [ ] **Step 1: Write failing frontend tests for center navigation, per-type detail views, and Zendesk migration behavior**

```tsx
it("renders the integration center in admin shell and switches between integration types", async () => {
  render(<AdminShell />);
  await userEvent.click(screen.getByRole("tab", { name: "集成中心" }));
  expect(await screen.findByText("DingTalk")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Zendesk" }));
  expect(await screen.findByText("Webhook 验证" )).toBeTruthy();
});

it("renders saved-secret state without exposing secret values", async () => {
  render(<OpenAICodexIntegrationView detail={fixture} />);
  expect(screen.getByText("已保存密钥")).toBeTruthy();
  expect(screen.queryByDisplayValue(/sk-/)).toBeNull();
});
```

- [ ] **Step 2: Run frontend tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/integration-center/api.test.ts src/features/integration-center/IntegrationCenterShell.test.tsx
```

Expected:
- FAIL because integration-center module does not exist yet

- [ ] **Step 3: Implement Integration Center shell and per-type views**

```tsx
{section === "integrations" ? <IntegrationCenterShell /> : null}
```

```tsx
export function IntegrationCenterShell() {
  const [type, setType] = useState<IntegrationType>("dingtalk");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useIntegrationCenterQuery(type);
  return (
    <div className="integration-center-shell">
      <IntegrationTypeNav type={type} onChange={setType} />
      <IntegrationInstanceList items={query.items} selectedId={selectedId} onSelect={setSelectedId} />
      <IntegrationDetailPanel type={type} instanceId={selectedId} />
    </div>
  );
}
```

- [ ] **Step 4: Run targeted frontend verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/integration-center/api.test.ts src/features/integration-center/IntegrationCenterShell.test.tsx src/features/integration-center/DingTalkIntegrationView.test.tsx src/features/integration-center/ZendeskIntegrationView.test.tsx src/features/integration-center/OpenAICodexIntegrationView.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
npm run build
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/features/integration-center \
  agent-ui/src/features/admin/AdminNav.tsx \
  agent-ui/src/features/admin/AdminShell.tsx \
  agent-ui/src/features/admin/types.ts \
  agent-ui/src/features/zendesk/ZendeskIntegrationPanel.tsx \
  agent-ui/src/styles.css
git commit -m "feat: add integration center admin console"
```

### Task 6: Final Verification and Regression Coverage

**Files:**
- Modify: any affected failing tests from previous tasks only
- Verify: backend and frontend full suite

- [ ] **Step 1: Run targeted backend regression suite for integrations and admin wiring**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/integrations/center/router.test.ts src/integrations/center/service.test.ts src/integrations/zendesk/router.test.ts src/admin/router.test.ts src/auth/dingtalk.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Run targeted frontend regression suite for integration center and admin shell**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/integration-center/api.test.ts src/features/integration-center/IntegrationCenterShell.test.tsx src/features/integration-center/DingTalkIntegrationView.test.tsx src/features/integration-center/ZendeskIntegrationView.test.tsx src/features/integration-center/OpenAICodexIntegrationView.test.tsx src/features/admin/AdminShell.test.tsx
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
git commit -m "fix: finalize integration center verification issues"
```

---

## Spec Coverage Check

Covered spec sections:
- unified Integration Center entry: Task 5
- unified integration instance model: Task 1
- DingTalk / Zendesk / OpenAI-Codex support: Tasks 3-5
- config editing and validation/test: Tasks 2-5
- secret rotation and secret-state handling: Tasks 1, 2, 5
- validation history visibility: Tasks 1, 2, 5
- integration RBAC + resource policy: Tasks 2, 5
- Zendesk migration into unified center: Tasks 3, 5

No uncovered core requirements remain from the spec.

## Self-Review

- Placeholder scan completed: no `TBD`, `TODO`, or unresolved implementation placeholders remain.
- Type consistency checked: `integration instance`, `validation history`, `bindings`, and `policies` terminology is consistent across tasks.
- Scope check passed: this plan is focused on Integration Center only and does not pull in System Settings.
