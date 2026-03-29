# Agent Studio Mode, Skill Package, And Run Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded portal mode/runtime derivation with persisted agent-mode, skill-package, run-profile, runtime-binding, and instruction-source models that the portal can consume through existing APIs.

**Architecture:** Add first-class Prisma models and repositories for agent modes, skill packages, run profiles, mode workspace rules, instruction sources, and runtime bindings. Reuse the existing `resource_policies` authorization model, add backend admin APIs and a portal runtime-option resolver service, then update the portal shell to consume backend-provided mode policy snapshots instead of local hardcoded derivation.

**Tech Stack:** Prisma, Express, TypeScript, Vitest, React, assistant-ui

---

## File Structure

### Backend

- Create: `agent-api/prisma/migrations/<generated>_add_mode_skill_profile_models/migration.sql`
- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/src/persistence/run-profile-repository.ts`
- Create: `agent-api/src/persistence/run-profile-repository.test.ts`
- Create: `agent-api/src/persistence/skill-package-repository.ts`
- Create: `agent-api/src/persistence/skill-package-repository.test.ts`
- Create: `agent-api/src/persistence/agent-mode-repository.ts`
- Create: `agent-api/src/persistence/agent-mode-repository.test.ts`
- Create: `agent-api/src/portal/runtime-option-service.ts`
- Create: `agent-api/src/portal/runtime-option-service.test.ts`
- Modify: `agent-api/src/resources/policy-service.ts`
- Modify: `agent-api/src/resources/policy-service.test.ts`
- Create: `agent-api/src/resources/mode-admin-router.ts`
- Create: `agent-api/src/resources/mode-admin-router.test.ts`
- Modify: `agent-api/src/app-routes.ts`
- Modify: `agent-api/src/index.ts`
- Modify: `agent-api/src/portal/router.ts`
- Modify: `agent-api/src/portal/runtime-options.ts`

### Frontend

- Create: `agent-ui/src/features/modes/types.ts`
- Create: `agent-ui/src/features/modes/runtime-profile-view.ts`
- Create: `agent-ui/src/features/modes/runtime-profile-view.test.ts`
- Modify: `agent-ui/src/features/portal/PortalShell.tsx`
- Modify: `agent-ui/src/features/portal/PortalShell.integration.test.tsx`
- Modify: `agent-ui/src/features/portal/runtime-labels.ts`
- Modify: `agent-ui/src/features/portal/runtime-labels.test.ts`
- Modify: `agent-ui/src/styles.css`

### Notes

- This phase does not add admin frontend pages.
- Existing `resource_policies` stays the only authorization table; repository and service logic are extended by `resource_type`.
- `agent_mode_workspaces` will constrain workspace visibility per selected mode while still cooperating with workspace authorization already implemented.

### Task 1: Add Prisma models for run profiles, skill packages, runtime bindings, and agent modes

**Files:**
- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/<generated>_add_mode_skill_profile_models/migration.sql`

- [ ] **Step 1: Write a schema diff check for the new tables**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE "(run_profiles|skill_packages|skill_package_items|skill_package_runtime_bindings|agent_modes|agent_mode_skill_packages|agent_mode_workspaces|agent_mode_instruction_sources)"'
```

Expected: FAIL because the schema does not yet define the new tables.

- [ ] **Step 2: Add the Prisma schema models**

Add these models to `agent-api/prisma/schema.prisma`:

```prisma
model RunProfile {
  id                     String   @id @default(cuid())
  organizationId         String?  @map("organization_id")
  name                   String
  slug                   String   @unique
  description            String?
  status                 String   @default("active")
  defaultModel           String   @map("default_model")
  allowedModels          Json     @map("allowed_models")
  defaultReasoningEffort String   @map("default_reasoning_effort")
  sandboxMode            String   @map("sandbox_mode")
  approvalPolicy         String   @map("approval_policy")
  networkAccessEnabled   Boolean  @default(false) @map("network_access_enabled")
  webSearchMode          String   @map("web_search_mode")
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")

  agentModes             AgentMode[]

  @@map("run_profiles")
}

model SkillPackage {
  id             String                    @id @default(cuid())
  organizationId String?                   @map("organization_id")
  name           String
  slug           String                    @unique
  description    String?
  status         String                    @default("active")
  visibleToUsers Boolean                   @default(false) @map("visible_to_users")
  createdAt      DateTime                  @default(now()) @map("created_at")
  updatedAt      DateTime                  @updatedAt @map("updated_at")

  items          SkillPackageItem[]
  modeBindings   AgentModeSkillPackage[]

  @@map("skill_packages")
}

model SkillPackageItem {
  id             String                     @id @default(cuid())
  skillPackageId String                     @map("skill_package_id")
  capabilityKey  String                     @map("capability_key")
  description    String?
  createdAt      DateTime                   @default(now()) @map("created_at")
  updatedAt      DateTime                   @updatedAt @map("updated_at")

  skillPackage   SkillPackage               @relation(fields: [skillPackageId], references: [id], onDelete: Cascade)
  runtimeBindings SkillPackageRuntimeBinding[]

  @@unique([skillPackageId, capabilityKey])
  @@map("skill_package_items")
}

model SkillPackageRuntimeBinding {
  id                 String   @id @default(cuid())
  skillPackageItemId String   @map("skill_package_item_id")
  runtimeType        String   @map("runtime_type")
  bindingType        String   @map("binding_type")
  bindingPayload     Json     @map("binding_payload")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  skillPackageItem   SkillPackageItem @relation(fields: [skillPackageItemId], references: [id], onDelete: Cascade)

  @@map("skill_package_runtime_bindings")
}

model AgentMode {
  id             String                      @id @default(cuid())
  organizationId String?                     @map("organization_id")
  name           String
  slug           String                      @unique
  description    String?
  status         String                      @default("active")
  visibleToUsers Boolean                     @default(true) @map("visible_to_users")
  runProfileId   String                      @map("run_profile_id")
  createdAt      DateTime                    @default(now()) @map("created_at")
  updatedAt      DateTime                    @updatedAt @map("updated_at")

  runProfile     RunProfile                  @relation(fields: [runProfileId], references: [id], onDelete: Restrict)
  skillPackages  AgentModeSkillPackage[]
  workspaces     AgentModeWorkspace[]
  instructionSources AgentModeInstructionSource[]

  @@map("agent_modes")
}

model AgentModeSkillPackage {
  id             String   @id @default(cuid())
  agentModeId    String   @map("agent_mode_id")
  skillPackageId String   @map("skill_package_id")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  agentMode      AgentMode    @relation(fields: [agentModeId], references: [id], onDelete: Cascade)
  skillPackage   SkillPackage @relation(fields: [skillPackageId], references: [id], onDelete: Cascade)

  @@unique([agentModeId, skillPackageId])
  @@map("agent_mode_skill_packages")
}

model AgentModeWorkspace {
  id                     String   @id @default(cuid())
  agentModeId            String   @map("agent_mode_id")
  workspaceId            String   @map("workspace_id")
  isDefault              Boolean  @default(false) @map("is_default")
  allowDirectorySelection Boolean @default(false) @map("allow_directory_selection")
  directoryScope         String   @map("directory_scope")
  loadWorkspaceAgentsMd  Boolean  @default(false) @map("load_workspace_agents_md")
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")

  agentMode              AgentMode  @relation(fields: [agentModeId], references: [id], onDelete: Cascade)
  workspace              Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([agentModeId, workspaceId])
  @@map("agent_mode_workspaces")
}

model AgentModeInstructionSource {
  id          String   @id @default(cuid())
  agentModeId String   @map("agent_mode_id")
  sourceType  String   @map("source_type")
  sourceRef   String   @map("source_ref")
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  agentMode   AgentMode @relation(fields: [agentModeId], references: [id], onDelete: Cascade)

  @@map("agent_mode_instruction_sources")
}
```

- [ ] **Step 3: Add the SQL migration**

Create a new migration directory for `add_mode_skill_profile_models` and add `migration.sql` with concrete `CREATE TABLE`, FK, unique index, and supporting index statements matching the schema above.

- [ ] **Step 4: Run Prisma generation and the schema diff check**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm run prisma:generate
npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE "(run_profiles|skill_packages|skill_package_items|skill_package_runtime_bindings|agent_modes|agent_mode_skill_packages|agent_mode_workspaces|agent_mode_instruction_sources)"'
```

Expected: PASS and prints the eight new tables.

- [ ] **Step 5: Commit the schema work**

```bash
git add agent-api/prisma/schema.prisma agent-api/prisma/migrations
git commit -m "feat: add mode skill profile schema"
```

### Task 2: Add repositories for run profiles, skill packages, and agent modes

**Files:**
- Create: `agent-api/src/persistence/run-profile-repository.ts`
- Create: `agent-api/src/persistence/run-profile-repository.test.ts`
- Create: `agent-api/src/persistence/skill-package-repository.ts`
- Create: `agent-api/src/persistence/skill-package-repository.test.ts`
- Create: `agent-api/src/persistence/agent-mode-repository.ts`
- Create: `agent-api/src/persistence/agent-mode-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests covering:

```ts
it("creates and updates run profiles with allowed model lists", async () => {
  const repository = new RunProfileRepository(new FakeRunProfileDb() as never);

  const created = await repository.create({
    name: "Coding Default",
    slug: "coding-default",
    defaultModel: "gpt-5.4",
    allowedModels: ["gpt-5.4", "gpt-5.4-mini"],
    defaultReasoningEffort: "high",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "live"
  });

  expect(created.allowedModels).toEqual(["gpt-5.4", "gpt-5.4-mini"]);
});

it("replaces skill package items and runtime bindings", async () => {
  const repository = new SkillPackageRepository(new FakeSkillPackageDb() as never);
  const skillPackage = await repository.create({ name: "Code Tools", slug: "code-tools" });

  await repository.replaceItems(skillPackage.id, [
    {
      capabilityKey: "filesystem.read",
      description: "Read files",
      runtimeBindings: [
        { runtimeType: "codex", bindingType: "config_fragment", bindingPayload: { tool: "fs_read" } },
        { runtimeType: "claude_code", bindingType: "prompt_hint", bindingPayload: { tool: "Read" } }
      ]
    }
  ]);

  const loaded = await repository.get(skillPackage.id);
  expect(loaded?.items[0]?.runtimeBindings).toHaveLength(2);
});

it("replaces mode skill packages, workspace rules, and instruction sources", async () => {
  const repository = new AgentModeRepository(new FakeAgentModeDb() as never);
  const mode = await repository.create({
    name: "Coding Assistant",
    slug: "coding-assistant",
    runProfileId: "profile-1"
  });

  await repository.replaceWorkspaceRules(mode.id, [
    {
      workspaceId: "workspace-1",
      isDefault: true,
      allowDirectorySelection: true,
      directoryScope: "descendants_only",
      loadWorkspaceAgentsMd: true
    }
  ]);

  await repository.replaceInstructionSources(mode.id, [
    { sourceType: "inline_text", sourceRef: "Always write tests first.", sortOrder: 10 }
  ]);

  const loaded = await repository.get(mode.id);
  expect(loaded?.workspaceRules[0]?.loadWorkspaceAgentsMd).toBe(true);
  expect(loaded?.instructionSources[0]?.sourceType).toBe("inline_text");
});
```

- [ ] **Step 2: Run the targeted repository tests and verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/persistence/run-profile-repository.test.ts src/persistence/skill-package-repository.test.ts src/persistence/agent-mode-repository.test.ts
```

Expected: FAIL because the repositories do not exist yet.

- [ ] **Step 3: Implement the repositories**

Implement CRUD and replacement APIs following existing repository style:

- `RunProfileRepository`
  - `create`
  - `get`
  - `list`
  - `update`
- `SkillPackageRepository`
  - `create`
  - `get`
  - `list`
  - `update`
  - `replaceItems`
- `AgentModeRepository`
  - `create`
  - `get`
  - `list`
  - `update`
  - `replaceSkillPackages`
  - `replaceWorkspaceRules`
  - `replaceInstructionSources`

Use the same mapping patterns as `workspace-repository.ts` and `knowledge-set-repository.ts`.

- [ ] **Step 4: Run the targeted repository tests and verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/persistence/run-profile-repository.test.ts src/persistence/skill-package-repository.test.ts src/persistence/agent-mode-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the repository work**

```bash
git add agent-api/src/persistence/run-profile-repository.ts agent-api/src/persistence/run-profile-repository.test.ts agent-api/src/persistence/skill-package-repository.ts agent-api/src/persistence/skill-package-repository.test.ts agent-api/src/persistence/agent-mode-repository.ts agent-api/src/persistence/agent-mode-repository.test.ts
git commit -m "feat: add mode skill profile repositories"
```

### Task 3: Extend policy evaluation to new resource types

**Files:**
- Modify: `agent-api/src/resources/policy-service.ts`
- Modify: `agent-api/src/resources/policy-service.test.ts`

- [ ] **Step 1: Write failing policy tests for mode, skill package, and run profile types**

Add tests:

```ts
it("filters agent modes through role, department, and user policies", async () => {
  const service = new PolicyService(
    new FakePolicyRepository([
      { subjectType: "role", subjectId: "employee", resourceType: "agent_mode", resourceId: "mode-chat", effect: "allow" },
      { subjectType: "department", subjectId: "dept-rd", resourceType: "agent_mode", resourceId: "mode-code", effect: "allow" },
      { subjectType: "user", subjectId: "user-1", resourceType: "agent_mode", resourceId: "mode-review", effect: "deny" }
    ]) as never
  );

  const visible = await service.filterAllowedResources({
    userId: "user-1",
    roleIds: ["employee"],
    departmentIds: ["dept-rd"],
    resourceType: "agent_mode",
    candidateIds: ["mode-chat", "mode-code", "mode-review"]
  });

  expect(visible).toEqual(["mode-chat", "mode-code"]);
});
```

- [ ] **Step 2: Run the policy tests and verify failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/resources/policy-service.test.ts
```

Expected: FAIL because the service and repository typing do not yet cover the new resource types.

- [ ] **Step 3: Extend the allowed resource type unions and tests**

Update the service and test doubles so `resourceType` accepts:

```ts
type ResourceType = "workspace" | "knowledge_set" | "agent_mode" | "skill_package" | "run_profile";
```

No behavioral redesign is needed; this task is a type and coverage expansion.

- [ ] **Step 4: Run the policy tests and verify pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/resources/policy-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the policy extension**

```bash
git add agent-api/src/resources/policy-service.ts agent-api/src/resources/policy-service.test.ts
git commit -m "feat: extend resource policies for mode skill profile resources"
```

### Task 4: Add admin CRUD APIs for modes, skill packages, and run profiles

**Files:**
- Create: `agent-api/src/resources/mode-admin-router.ts`
- Create: `agent-api/src/resources/mode-admin-router.test.ts`
- Modify: `agent-api/src/app-routes.ts`
- Modify: `agent-api/src/index.ts`

- [ ] **Step 1: Write failing admin API tests**

Add tests for representative CRUD and binding flows:

```ts
it("creates and lists run profiles", async () => {
  const app = buildModeAdminApp();

  const createResponse = await request(app)
    .post("/api/admin/run-profiles")
    .set("Cookie", adminCookie)
    .send({
      name: "Standard Profile",
      slug: "standard-profile",
      defaultModel: "gpt-5.4",
      allowedModels: ["gpt-5.4"],
      defaultReasoningEffort: "high",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "disabled"
    });

  expect(createResponse.status).toBe(200);

  const listResponse = await request(app).get("/api/admin/run-profiles").set("Cookie", adminCookie);
  expect(listResponse.body.runProfiles).toHaveLength(1);
});

it("replaces agent mode skill packages and workspace rules", async () => {
  const app = buildModeAdminApp();

  const response = await request(app)
    .put("/api/admin/agent-modes/mode-1/workspaces")
    .set("Cookie", adminCookie)
    .send({
      workspaceRules: [
        {
          workspaceId: "workspace-1",
          isDefault: true,
          allowDirectorySelection: true,
          directoryScope: "descendants_only",
          loadWorkspaceAgentsMd: true
        }
      ]
    });

  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run the admin API tests and verify failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/resources/mode-admin-router.test.ts
```

Expected: FAIL because the router does not exist.

- [ ] **Step 3: Implement the admin router**

Add Express routes mirroring the spec:

- `/api/admin/run-profiles`
- `/api/admin/skill-packages`
- `/api/admin/skill-packages/:id/items`
- `/api/admin/skill-packages/:id/runtime-bindings`
- `/api/admin/agent-modes`
- `/api/admin/agent-modes/:id/skill-packages`
- `/api/admin/agent-modes/:id/workspaces`
- `/api/admin/agent-modes/:id/instruction-sources`

Validate inputs with `zod` inside the router module.

- [ ] **Step 4: Wire the router into the app**

Update `registerCommonApiRoutes` and `index.ts` to mount the new admin resource router under `/api/admin` with the existing admin auth behavior.

- [ ] **Step 5: Run the admin API tests and verify pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/resources/mode-admin-router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the admin API work**

```bash
git add agent-api/src/resources/mode-admin-router.ts agent-api/src/resources/mode-admin-router.test.ts agent-api/src/app-routes.ts agent-api/src/index.ts
git commit -m "feat: add mode skill profile admin apis"
```

### Task 5: Add portal runtime option resolver service

**Files:**
- Create: `agent-api/src/portal/runtime-option-service.ts`
- Create: `agent-api/src/portal/runtime-option-service.test.ts`

- [ ] **Step 1: Write failing resolver tests for authorized mode resolution**

Add tests:

```ts
it("returns only authorized visible modes with resolved runtime profile snapshots", async () => {
  const service = new PortalRuntimeOptionService({
    modes: new FakeAgentModeRepository([...]),
    workspaces: new FakeWorkspaceRepository([...]),
    policies: new PolicyService(new FakePolicyRepository([...]) as never)
  });

  const resolved = await service.resolve({
    userId: "user-1",
    roleIds: ["employee"],
    departmentIds: ["dept-rd"]
  });

  expect(resolved.modes).toEqual([
    {
      id: "mode-code",
      label: "代码助手",
      description: "面向代码任务",
      runtimeProfile: expect.objectContaining({ defaultModel: "gpt-5.4" }),
      allowDirectorySelection: true
    }
  ]);
});

it("filters out modes whose run profile or skill packages are disabled or unauthorized", async () => {
  // assert that invalid dependent resources suppress the mode
});
```

- [ ] **Step 2: Run the resolver tests and verify failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/portal/runtime-option-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the resolver service**

Implement a service that:

- loads active visible modes
- filters them by `resource_policies`
- validates dependent run profiles and skill packages are active and authorized
- filters available workspaces through both workspace authorization and mode workspace bindings
- resolves the effective portal-mode snapshot for the current shell

Return a service result shaped for easy translation into `PortalRuntimeOptions`.

- [ ] **Step 4: Run the resolver tests and verify pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/portal/runtime-option-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the resolver service**

```bash
git add agent-api/src/portal/runtime-option-service.ts agent-api/src/portal/runtime-option-service.test.ts
git commit -m "feat: add portal mode runtime option resolver"
```

### Task 6: Replace hardcoded portal runtime-options derivation with persisted policy resolution

**Files:**
- Modify: `agent-api/src/portal/router.ts`
- Modify: `agent-api/src/portal/runtime-options.ts`
- Modify: `agent-api/src/index.ts`
- Test: `agent-api/src/resources/portal-router.test.ts`
- Test: `agent-api/src/portal/runtime-option-service.test.ts`

- [ ] **Step 1: Write a failing integration test for `/api/portal/runtime-options`**

Add a route-level test proving the endpoint now returns persisted mode data instead of hardcoded `standard/review` logic:

```ts
it("returns authorized persisted portal mode options", async () => {
  const app = buildPortalRuntimeOptionApp({
    modes: [
      {
        id: "mode-code",
        name: "代码助手",
        slug: "coding",
        visibleToUsers: true,
        status: "active"
      }
    ]
  });

  const response = await request(app)
    .get("/api/portal/runtime-options")
    .set("Cookie", cookies.create("employee-1"));

  expect(response.status).toBe(200);
  expect(response.body.modes).toEqual([
    expect.objectContaining({ id: "mode-code", label: "代码助手" })
  ]);
});
```

- [ ] **Step 2: Run the route-level tests and verify failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/portal/runtime-option-service.test.ts src/resources/portal-router.test.ts
```

Expected: FAIL because the route still derives modes locally.

- [ ] **Step 3: Implement the portal router changes**

Refactor `portal/runtime-options.ts` and `portal/router.ts` so the route is backed by the new resolver service instead of `derivePortalRuntimeOptions()` hardcoded role logic.

The top-level response shape must stay compatible:

```ts
{
  modes: [{ id, label, description, runtimeProfile, allowDirectorySelection }],
  workspaces: [...],
  canUpload: true,
  defaults: { mode, workspace }
}
```

- [ ] **Step 4: Wire the resolver in `index.ts`**

Instantiate the new repositories and resolver service in `index.ts` and inject them into `createPortalRouter()`.

- [ ] **Step 5: Run the route-level tests and verify pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm exec -- vitest run src/portal/runtime-option-service.test.ts src/resources/portal-router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the portal runtime option migration**

```bash
git add agent-api/src/portal/router.ts agent-api/src/portal/runtime-options.ts agent-api/src/index.ts agent-api/src/portal/runtime-option-service.test.ts agent-api/src/resources/portal-router.test.ts
git commit -m "feat: resolve portal runtime options from persisted modes"
```

### Task 7: Integrate portal shell with backend-provided mode/runtime snapshots

**Files:**
- Create: `agent-ui/src/features/modes/types.ts`
- Create: `agent-ui/src/features/modes/runtime-profile-view.ts`
- Create: `agent-ui/src/features/modes/runtime-profile-view.test.ts`
- Modify: `agent-ui/src/features/portal/PortalShell.tsx`
- Modify: `agent-ui/src/features/portal/PortalShell.integration.test.tsx`
- Modify: `agent-ui/src/features/portal/runtime-labels.ts`
- Modify: `agent-ui/src/features/portal/runtime-labels.test.ts`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing frontend tests for persisted mode rendering**

Add tests:

```tsx
it("renders mode options from the backend runtime-options payload", async () => {
  mockedApi.mockResolvedValueOnce({
    modes: [
      {
        id: "mode-code",
        label: "代码助手",
        description: "面向代码任务",
        runtimeProfile: {
          defaultModel: "gpt-5.4",
          defaultReasoningEffort: "high",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "live"
        },
        allowDirectorySelection: true
      }
    ],
    workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
    canUpload: true,
    defaults: { mode: "mode-code", workspace: "/workspace/default" }
  });

  render(<PortalShell />);

  expect(await screen.findByDisplayValue("代码助手")).toBeTruthy();
  expect(screen.getByText(/gpt-5.4/)).toBeTruthy();
});
```

- [ ] **Step 2: Run the targeted frontend tests and verify failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm exec -- vitest run src/features/modes/runtime-profile-view.test.ts src/features/portal/PortalShell.integration.test.tsx src/features/portal/runtime-labels.test.ts
```

Expected: FAIL because the new mode payload shape is not yet supported.

- [ ] **Step 3: Add mode types and runtime-profile display helpers**

Implement frontend types and a focused display helper/component for the runtime snapshot returned by the backend.

- [ ] **Step 4: Update `PortalShell.tsx` to consume the new mode snapshot**

Refactor the portal shell so:

- mode options come entirely from the API
- displayed model / reasoning labels follow the selected mode’s `runtimeProfile`
- directory-selection affordance only appears when `allowDirectorySelection` is true
- the employee still cannot edit raw sandbox / approval / network / search controls

- [ ] **Step 5: Run the targeted frontend tests and verify pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm exec -- vitest run src/features/modes/runtime-profile-view.test.ts src/features/portal/PortalShell.integration.test.tsx src/features/portal/runtime-labels.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full frontend suite and verify pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit the portal shell integration**

```bash
git add agent-ui/src/features/modes agent-ui/src/features/portal/PortalShell.tsx agent-ui/src/features/portal/PortalShell.integration.test.tsx agent-ui/src/features/portal/runtime-labels.ts agent-ui/src/features/portal/runtime-labels.test.ts agent-ui/src/styles.css
git commit -m "feat: consume persisted mode runtime profiles in portal"
```

### Task 8: Verify end-to-end backend and frontend behavior

**Files:**
- Verify existing touched files only

- [ ] **Step 1: Run the full backend suite**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run the full frontend suite**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 3: Review the completed feature set against the spec**

Confirm all of the following are true:

- persisted `agent_mode`, `skill_package`, `run_profile`, runtime-binding, workspace-rule, and instruction-source models exist
- admin APIs exist for managing those models and bindings
- `resource_policies` support the new resource types
- `/api/portal/runtime-options` is no longer hardcoded
- portal mode selection is backend-driven
- selected mode snapshot controls displayed runtime policy
- directory selection is only offered when the selected mode allows it
- no new employee-facing raw runtime editing was introduced

- [ ] **Step 4: Commit any final verification-only fixes if needed**

```bash
git add -A
git commit -m "fix: finalize mode skill profile integration"
```

Only do this step if verification exposes a real issue that requires a patch.

## Self-Review Checklist

- Spec coverage:
  - Prisma models and migrations are covered by Task 1.
  - repository and binding persistence are covered by Task 2.
  - policy extension is covered by Task 3.
  - admin CRUD APIs are covered by Task 4.
  - portal runtime-option resolution is covered by Tasks 5 and 6.
  - portal shell consumption is covered by Task 7.
  - end-to-end verification is covered by Task 8.
- Placeholder scan:
  - No `TODO`, `TBD`, or “implement later” markers remain in tasks.
- Type consistency:
  - The plan consistently uses `agent_mode`, `skill_package`, `run_profile`, runtime binding, workspace rule, and instruction source terminology from the approved spec.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-29-agent-studio-mode-skill-profiles.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
