# Agent Studio Capability Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified admin capability center for `agent_mode`, `skill_package`, and `run_profile`, including lifecycle management, bindings, copy flows, and per-resource authorization editing.

**Architecture:** Reuse the existing mode admin router and persistence layer instead of creating a parallel capability backend. Extend backend APIs for copy flows, mode workspace / directory policy editing, instruction-source editing, and per-resource authorization, then build a new frontend `capability-center` feature that mirrors the resource-center interaction model with shared list/detail patterns and tabbed detail editing.

**Tech Stack:** Prisma, Express, TypeScript, Vitest, React, Vite, assistant-ui patterns

---

## File Structure

### Backend

- Modify: `agent-api/src/resources/mode-admin-router.ts`
- Modify: `agent-api/src/resources/mode-admin-router.test.ts`
- Modify: `agent-api/src/persistence/agent-mode-repository.ts`
- Modify: `agent-api/src/persistence/agent-mode-repository.test.ts`
- Modify: `agent-api/src/persistence/skill-package-repository.ts`
- Modify: `agent-api/src/persistence/skill-package-repository.test.ts`
- Modify: `agent-api/src/persistence/run-profile-repository.ts`
- Modify: `agent-api/src/persistence/run-profile-repository.test.ts`
- Modify: `agent-api/src/admin/router.test.ts`
- Modify: `agent-api/src/index.ts`

### Frontend

- Create: `agent-ui/src/features/capability-center/types.ts`
- Create: `agent-ui/src/features/capability-center/api.ts`
- Create: `agent-ui/src/features/capability-center/api.test.ts`
- Create: `agent-ui/src/features/capability-center/CapabilityCenterShell.tsx`
- Create: `agent-ui/src/features/capability-center/CapabilityCenterShell.test.tsx`
- Create: `agent-ui/src/features/capability-center/RunProfileDetailView.tsx`
- Create: `agent-ui/src/features/capability-center/RunProfileDetailView.test.tsx`
- Create: `agent-ui/src/features/capability-center/SkillPackageDetailView.tsx`
- Create: `agent-ui/src/features/capability-center/SkillPackageDetailView.test.tsx`
- Create: `agent-ui/src/features/capability-center/SkillPackageItemEditor.tsx`
- Create: `agent-ui/src/features/capability-center/SkillPackageItemEditor.test.tsx`
- Create: `agent-ui/src/features/capability-center/AgentModeDetailView.tsx`
- Create: `agent-ui/src/features/capability-center/AgentModeDetailView.test.tsx`
- Create: `agent-ui/src/features/capability-center/InstructionSourceEditor.tsx`
- Create: `agent-ui/src/features/capability-center/InstructionSourceEditor.test.tsx`
- Create: `agent-ui/src/features/capability-center/CapabilityPolicyEditor.tsx`
- Create: `agent-ui/src/features/capability-center/CapabilityPolicyEditor.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/features/admin/types.ts`
- Modify: `agent-ui/src/styles.css`

### Docs

- Reference: `docs/superpowers/specs/2026-03-30-agent-studio-capability-center-design.md`

## Notes

- Reuse the existing `resource_policies` backend model for `agent_mode`, `skill_package`, and `run_profile`; do not create a second authorization system.
- Frontend timestamps must render in the admin user's local timezone.
- Lifecycle operations are limited to create, edit, copy, enable, and disable; do not add delete.
- `agent_mode` directory policy editing remains policy-definition only; do not expose arbitrary server path editing.
- Copy flows must use a deterministic policy across all three resource types. This plan uses `disabled` as the copied record default to avoid accidental rollout.

### Task 1: Extend backend capability admin APIs for copy flows and missing bindings

**Files:**
- Modify: `agent-api/src/resources/mode-admin-router.ts`
- Modify: `agent-api/src/resources/mode-admin-router.test.ts`
- Modify: `agent-api/src/admin/router.test.ts`

- [ ] **Step 1: Write failing router tests for copy and missing binding endpoints**

Add tests in `agent-api/src/resources/mode-admin-router.test.ts` covering:

```ts
it("copies a run profile into a disabled record", async () => {
  const createResponse = await request(app)
    .post("/api/admin/run-profiles")
    .set("Cookie", cookies.create(adminUser.id))
    .send({
      name: "Coding Default",
      slug: "coding-default",
      description: "default",
      status: "active",
      defaultModel: "gpt-5.4",
      allowedModels: ["gpt-5.4"],
      defaultReasoningEffort: "high",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "live"
    });

  const response = await request(app)
    .post(`/api/admin/run-profiles/${createResponse.body.runProfile.id}/copy`)
    .set("Cookie", cookies.create(adminUser.id))
    .send({ name: "Coding Default Copy", slug: "coding-default-copy" });

  expect(response.status).toBe(201);
  expect(response.body.runProfile.status).toBe("disabled");
});

it("replaces agent mode workspace rules and instruction sources", async () => {
  const response = await request(app)
    .put(`/api/admin/agent-modes/${agentMode.id}/workspaces`)
    .set("Cookie", cookies.create(adminUser.id))
    .send({
      workspaces: [
        {
          workspaceId: workspace.id,
          isDefault: true,
          allowDirectorySelection: true,
          directoryScope: "authorized_workspace_and_knowledge_set",
          loadWorkspaceAgentsMd: true
        }
      ]
    });

  expect(response.status).toBe(200);
  expect(response.body.agentMode.workspaces).toEqual([
    expect.objectContaining({ workspaceId: workspace.id, loadWorkspaceAgentsMd: true })
  ]);
});
```

Also add a failing authorization-route test in `agent-api/src/admin/router.test.ts` covering:

```ts
const response = await request(app)
  .get("/api/admin/run-profiles")
  .set("Cookie", cookies.create(employee.id));

expect(response.status).toBe(403);
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/resources/mode-admin-router.test.ts src/admin/router.test.ts
```

Expected: FAIL because the copy and binding routes do not exist yet.

- [ ] **Step 3: Implement copy and binding endpoints in the existing mode admin router**

Update `agent-api/src/resources/mode-admin-router.ts` to add:

- `POST /run-profiles/:id/copy`
- `POST /skill-packages/:id/copy`
- `POST /agent-modes/:id/copy`
- `PUT /agent-modes/:id/workspaces`
- `PUT /agent-modes/:id/instruction-sources`

Implementation rules:

```ts
const copied = await options.runProfiles.copy(req.params.id, {
  name: parsed.data.name,
  slug: parsed.data.slug,
  status: "disabled"
});
```

```ts
const agentMode = await options.agentModes.replaceWorkspaces(req.params.id, parsed.data.workspaces);
const agentMode = await options.agentModes.replaceInstructionSources(req.params.id, parsed.data.instructionSources);
```

Keep validation explicit for:
- `directoryScope`
- `sourceType`
- `workspaceId`
- instruction-source payload shape

- [ ] **Step 4: Re-run targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/resources/mode-admin-router.test.ts src/admin/router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the backend capability router extensions**

```bash
git add agent-api/src/resources/mode-admin-router.ts agent-api/src/resources/mode-admin-router.test.ts agent-api/src/admin/router.test.ts
git commit -m "feat: extend capability admin routes"
```

### Task 2: Extend repositories for copy support and full agent-mode binding persistence

**Files:**
- Modify: `agent-api/src/persistence/agent-mode-repository.ts`
- Modify: `agent-api/src/persistence/agent-mode-repository.test.ts`
- Modify: `agent-api/src/persistence/skill-package-repository.ts`
- Modify: `agent-api/src/persistence/skill-package-repository.test.ts`
- Modify: `agent-api/src/persistence/run-profile-repository.ts`
- Modify: `agent-api/src/persistence/run-profile-repository.test.ts`

- [ ] **Step 1: Write failing repository tests for copy behavior and full bindings**

Add tests such as:

```ts
it("copies a skill package with items and runtime bindings into a disabled record", async () => {
  const copied = await repository.copy(existing.id, {
    name: "Support Tools Copy",
    slug: "support-tools-copy",
    status: "disabled",
    visibleToUsers: false
  });

  expect(copied.slug).toBe("support-tools-copy");
  expect(copied.status).toBe("disabled");
  expect(copied.items).toEqual([
    expect.objectContaining({ capabilityKey: "ticket.search" })
  ]);
});

it("replaces ordered instruction sources for an agent mode", async () => {
  const updated = await repository.replaceInstructionSources(mode.id, [
    { sourceType: "inline", sourceRef: "You are concise.", sortOrder: 0 },
    { sourceType: "workspace_agents_md", sourceRef: "workspace-root", sortOrder: 1 }
  ]);

  expect(updated.instructionSources.map((item) => item.sourceType)).toEqual([
    "inline",
    "workspace_agents_md"
  ]);
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/persistence/run-profile-repository.test.ts src/persistence/skill-package-repository.test.ts src/persistence/agent-mode-repository.test.ts
```

Expected: FAIL because copy helpers and binding replacement APIs are incomplete.

- [ ] **Step 3: Implement repository copy helpers and binding replacement methods**

Add repository methods:

```ts
copy(id: string, overrides: { name: string; slug: string; status: string }): Promise<RunProfileRecord>
copy(id: string, overrides: { name: string; slug: string; status: string; visibleToUsers: boolean }): Promise<SkillPackageRecord>
copy(id: string, overrides: { name: string; slug: string; status: string; visibleToUsers: boolean }): Promise<AgentModeRecord>
replaceWorkspaces(id: string, workspaces: ReplaceAgentModeWorkspacesPayload): Promise<AgentModeRecord>
replaceInstructionSources(id: string, sources: ReplaceAgentModeInstructionSourcesPayload): Promise<AgentModeRecord>
```

Copy rules:
- preserve allowed models / runtime fields for `run_profile`
- preserve item rows and runtime bindings for `skill_package`
- preserve run-profile binding, skill-package ids, workspace rules, and instruction-source rows for `agent_mode`
- set copied records to `disabled`
- set `visibleToUsers` on copied `skill_package` and `agent_mode` records to `false`

- [ ] **Step 4: Re-run targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/persistence/run-profile-repository.test.ts src/persistence/skill-package-repository.test.ts src/persistence/agent-mode-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit repository support for capability center operations**

```bash
git add agent-api/src/persistence/run-profile-repository.ts agent-api/src/persistence/run-profile-repository.test.ts agent-api/src/persistence/skill-package-repository.ts agent-api/src/persistence/skill-package-repository.test.ts agent-api/src/persistence/agent-mode-repository.ts agent-api/src/persistence/agent-mode-repository.test.ts
git commit -m "feat: extend capability repositories"
```

### Task 3: Build typed frontend API support and capability-center shell

**Files:**
- Create: `agent-ui/src/features/capability-center/types.ts`
- Create: `agent-ui/src/features/capability-center/api.ts`
- Create: `agent-ui/src/features/capability-center/api.test.ts`
- Create: `agent-ui/src/features/capability-center/CapabilityCenterShell.tsx`
- Create: `agent-ui/src/features/capability-center/CapabilityCenterShell.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/features/admin/types.ts`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing frontend tests for capability-center navigation and typed API calls**

Add tests such as:

```tsx
it("navigates from admin shell into the capability center", async () => {
  render(<AdminShell />);
  fireEvent.click(await screen.findByRole("button", { name: "能力配置中心" }));
  expect(await screen.findByRole("heading", { name: "能力配置中心" })).toBeTruthy();
  expect(await screen.findByRole("tab", { name: "Agent Modes" })).toBeTruthy();
});

it("loads run profiles, skill packages, and agent modes through typed helpers", async () => {
  mockedFetchRunProfiles.mockResolvedValue({ runProfiles: [] });
  mockedFetchSkillPackages.mockResolvedValue({ skillPackages: [] });
  mockedFetchAgentModes.mockResolvedValue({ agentModes: [] });
  render(<CapabilityCenterShell />);
  expect(await screen.findByText("没有可用能力资源")).toBeTruthy();
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/capability-center/api.test.ts src/features/capability-center/CapabilityCenterShell.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
```

Expected: FAIL because the capability-center frontend does not exist yet.

- [ ] **Step 3: Implement typed API helpers and the shell container**

Create `agent-ui/src/features/capability-center/api.ts` helpers for:

```ts
fetchRunProfiles()
createRunProfile(input)
updateRunProfile(id, input)
copyRunProfile(id, input)
fetchSkillPackages()
createSkillPackage(input)
updateSkillPackage(id, input)
copySkillPackage(id, input)
putSkillPackageItems(id, items)
putSkillPackageRuntimeBindings(id, bindings)
fetchAgentModes()
createAgentMode(input)
updateAgentMode(id, input)
copyAgentMode(id, input)
putAgentModeSkillPackages(id, skillPackageIds)
putAgentModeWorkspaces(id, workspaces)
putAgentModeInstructionSources(id, instructionSources)
fetchCapabilityPolicies(resourceType, resourceId)
putCapabilityPolicies(resourceType, resourceId, policies)
```

Build `CapabilityCenterShell.tsx` with:
- left-side type switcher: `Agent Modes`, `Skill Packages`, `Run Profiles`
- search box
- status filter
- visibility filter
- create button
- right-side create panel / detail mount / empty state

Mount the shell in `AdminShell` under a new section such as `capabilities` and add the nav item in `AdminNav`.

- [ ] **Step 4: Re-run targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/capability-center/api.test.ts src/features/capability-center/CapabilityCenterShell.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the capability-center shell**

```bash
git add agent-ui/src/features/capability-center agent-ui/src/features/admin/AdminNav.tsx agent-ui/src/features/admin/AdminNav.test.tsx agent-ui/src/features/admin/AdminShell.tsx agent-ui/src/features/admin/AdminShell.test.tsx agent-ui/src/features/admin/types.ts agent-ui/src/styles.css
git commit -m "feat: add capability center shell"
```

### Task 4: Implement run-profile detail editing and shared capability authorization UI

**Files:**
- Create: `agent-ui/src/features/capability-center/RunProfileDetailView.tsx`
- Create: `agent-ui/src/features/capability-center/RunProfileDetailView.test.tsx`
- Create: `agent-ui/src/features/capability-center/CapabilityPolicyEditor.tsx`
- Create: `agent-ui/src/features/capability-center/CapabilityPolicyEditor.test.tsx`
- Modify: `agent-ui/src/features/capability-center/CapabilityCenterShell.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing tests for run-profile editing and authorization**

Add tests such as:

```tsx
it("saves run-profile policy fields from the detail tabs", async () => {
  render(<RunProfileDetailView runProfile={profile} onRunProfileUpdated={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText("默认模型"), { target: { value: "gpt-5.4-mini" } });
  fireEvent.click(screen.getByRole("button", { name: "保存运行策略" }));
  await waitFor(() => expect(mockedUpdateRunProfile).toHaveBeenCalled());
});

it("edits capability resource policies for a run profile", async () => {
  render(<CapabilityPolicyEditor resourceType="run_profile" resourceId="rp-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "新增策略" }));
  fireEvent.change(screen.getByLabelText("主体类型 1"), { target: { value: "department" } });
  fireEvent.change(screen.getByLabelText("主体标识 1"), { target: { value: "dept-rd" } });
  fireEvent.change(screen.getByLabelText("授权效果 1"), { target: { value: "deny" } });
  fireEvent.click(screen.getByRole("button", { name: "保存授权" }));
  await waitFor(() => expect(mockedPutCapabilityPolicies).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/capability-center/RunProfileDetailView.test.tsx src/features/capability-center/CapabilityPolicyEditor.test.tsx
```

Expected: FAIL because the detail and policy components do not exist yet.

- [ ] **Step 3: Implement the run-profile detail view and shared capability policy editor**

`RunProfileDetailView.tsx` should provide tabbed editing for:
- `基本信息`
- `绑定关系` (preview-only fields for directory policy / `AGENTS.md` / instruction preview)
- `授权`

Editable run-profile fields include:
- name
- slug
- description
- status
- default model
- allowed models
- reasoning effort
- sandbox mode
- approval policy
- network access flag
- web search mode

`CapabilityPolicyEditor.tsx` should mirror the resource-center policy editing model but support resource types:
- `run_profile`
- `skill_package`
- `agent_mode`

- [ ] **Step 4: Re-run targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/capability-center/RunProfileDetailView.test.tsx src/features/capability-center/CapabilityPolicyEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit run-profile editing and shared authorization UI**

```bash
git add agent-ui/src/features/capability-center/RunProfileDetailView.tsx agent-ui/src/features/capability-center/RunProfileDetailView.test.tsx agent-ui/src/features/capability-center/CapabilityPolicyEditor.tsx agent-ui/src/features/capability-center/CapabilityPolicyEditor.test.tsx agent-ui/src/features/capability-center/CapabilityCenterShell.tsx agent-ui/src/styles.css
git commit -m "feat: add run profile capability management"
```

### Task 5: Implement skill-package detail editing with item and runtime-binding management

**Files:**
- Create: `agent-ui/src/features/capability-center/SkillPackageDetailView.tsx`
- Create: `agent-ui/src/features/capability-center/SkillPackageDetailView.test.tsx`
- Create: `agent-ui/src/features/capability-center/SkillPackageItemEditor.tsx`
- Create: `agent-ui/src/features/capability-center/SkillPackageItemEditor.test.tsx`
- Modify: `agent-ui/src/features/capability-center/CapabilityCenterShell.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing tests for skill-package editing**

Add tests such as:

```tsx
it("saves skill-package metadata, items, and runtime bindings", async () => {
  render(<SkillPackageDetailView skillPackage={skillPackage} onSkillPackageUpdated={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText("技能包名称"), { target: { value: "Support Tools" } });
  fireEvent.click(screen.getByRole("button", { name: "新增能力项" }));
  fireEvent.change(screen.getByLabelText("capability_key 1"), { target: { value: "ticket.search" } });
  fireEvent.click(screen.getByRole("button", { name: "保存技能包" }));
  await waitFor(() => expect(mockedPutSkillPackageItems).toHaveBeenCalled());
  await waitFor(() => expect(mockedPutSkillPackageRuntimeBindings).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/capability-center/SkillPackageDetailView.test.tsx src/features/capability-center/SkillPackageItemEditor.test.tsx
```

Expected: FAIL because the skill-package detail feature does not exist yet.

- [ ] **Step 3: Implement skill-package detail and item editor components**

`SkillPackageDetailView.tsx` should provide tabs for:
- `基本信息`
- `绑定关系`
- `授权`

Editable fields:
- name
- slug
- description
- status
- `visibleToUsers`

`SkillPackageItemEditor.tsx` should manage a structured table with at least:
- `capability_key`
- description
- runtime
- binding

The detail save flow should call:
- `updateSkillPackage()`
- `putSkillPackageItems()`
- `putSkillPackageRuntimeBindings()`

- [ ] **Step 4: Re-run targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/capability-center/SkillPackageDetailView.test.tsx src/features/capability-center/SkillPackageItemEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit skill-package management UI**

```bash
git add agent-ui/src/features/capability-center/SkillPackageDetailView.tsx agent-ui/src/features/capability-center/SkillPackageDetailView.test.tsx agent-ui/src/features/capability-center/SkillPackageItemEditor.tsx agent-ui/src/features/capability-center/SkillPackageItemEditor.test.tsx agent-ui/src/features/capability-center/CapabilityCenterShell.tsx agent-ui/src/styles.css
git commit -m "feat: add skill package capability management"
```

### Task 6: Implement agent-mode detail editing for bindings, directory policy, and instruction sources

**Files:**
- Create: `agent-ui/src/features/capability-center/AgentModeDetailView.tsx`
- Create: `agent-ui/src/features/capability-center/AgentModeDetailView.test.tsx`
- Create: `agent-ui/src/features/capability-center/InstructionSourceEditor.tsx`
- Create: `agent-ui/src/features/capability-center/InstructionSourceEditor.test.tsx`
- Modify: `agent-ui/src/features/capability-center/CapabilityCenterShell.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing tests for agent-mode binding and instruction editing**

Add tests such as:

```tsx
it("saves run-profile, skill-package, workspace, directory policy, and instruction source bindings", async () => {
  render(<AgentModeDetailView agentMode={agentMode} runProfiles={runProfiles} skillPackages={skillPackages} workspaces={workspaces} knowledgeSets={knowledgeSets} onAgentModeUpdated={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText("运行策略"), { target: { value: "rp-coding" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Support Tools" }));
  fireEvent.click(screen.getByRole("button", { name: "新增指令源" }));
  fireEvent.change(screen.getByLabelText("指令源类型 1"), { target: { value: "knowledge_set_document" } });
  fireEvent.click(screen.getByRole("button", { name: "保存模式配置" }));
  await waitFor(() => expect(mockedPutAgentModeSkillPackages).toHaveBeenCalled());
  await waitFor(() => expect(mockedPutAgentModeWorkspaces).toHaveBeenCalled());
  await waitFor(() => expect(mockedPutAgentModeInstructionSources).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/capability-center/AgentModeDetailView.test.tsx src/features/capability-center/InstructionSourceEditor.test.tsx
```

Expected: FAIL because the agent-mode capability-management UI does not exist yet.

- [ ] **Step 3: Implement the agent-mode detail and instruction-source editor**

`AgentModeDetailView.tsx` should provide tabs for:
- `基本信息`
- `绑定关系`
- `授权`

Editable bindings include:
- one `runProfileId`
- many `skillPackageIds`
- workspace selection list
- `allowDirectorySelection`
- `directoryScope`
- `loadWorkspaceAgentsMd`
- ordered instruction sources

`InstructionSourceEditor.tsx` should support source rows for:
- `inline`
- `workspace_agents_md`
- `knowledge_set_document`

- [ ] **Step 4: Re-run targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/capability-center/AgentModeDetailView.test.tsx src/features/capability-center/InstructionSourceEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit agent-mode capability management UI**

```bash
git add agent-ui/src/features/capability-center/AgentModeDetailView.tsx agent-ui/src/features/capability-center/AgentModeDetailView.test.tsx agent-ui/src/features/capability-center/InstructionSourceEditor.tsx agent-ui/src/features/capability-center/InstructionSourceEditor.test.tsx agent-ui/src/features/capability-center/CapabilityCenterShell.tsx agent-ui/src/styles.css
git commit -m "feat: add agent mode capability management"
```

### Task 7: Run targeted and full verification for capability center

**Files:**
- Verify only

- [ ] **Step 1: Run backend targeted verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/resources/mode-admin-router.test.ts src/persistence/run-profile-repository.test.ts src/persistence/skill-package-repository.test.ts src/persistence/agent-mode-repository.test.ts src/admin/router.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend targeted verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/capability-center/api.test.ts src/features/capability-center/CapabilityCenterShell.test.tsx src/features/capability-center/RunProfileDetailView.test.tsx src/features/capability-center/SkillPackageDetailView.test.tsx src/features/capability-center/SkillPackageItemEditor.test.tsx src/features/capability-center/AgentModeDetailView.test.tsx src/features/capability-center/InstructionSourceEditor.test.tsx src/features/capability-center/CapabilityPolicyEditor.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test && npm run build

cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test && npm run build
```

Expected: PASS. Existing non-blocking Vite chunk-size warnings may remain if builds succeed.

- [ ] **Step 4: Commit any verification fixes if required**

```bash
git add agent-api agent-ui
git commit -m "fix: align capability center verification issues"
```

Only create this commit if verification exposes real issues.
