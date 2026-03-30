# Agent Studio Resource Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified admin resource configuration center that lets admins fully operate workspaces and knowledge sets, including bindings, authorization, uploads, file-tree inspection, and controlled filesystem file actions.

**Architecture:** Extend the existing resources admin router instead of introducing a second resource backend surface. Add the missing backend APIs, file-operation services, RBAC permission keys, and audit hooks first, then build a new `resource-center` frontend feature mounted inside the current admin shell. Keep runtime behavior unchanged by treating the resource center as an operating surface over the already-implemented workspace / knowledge-set models.

**Tech Stack:** Prisma, Express, TypeScript, Multer, existing knowledge-set filesystem storage adapter, React, Vite, Vitest, Supertest.

---

## File Structure

### Backend

- Modify: `agent-api/src/resources/admin-router.ts`
- Modify: `agent-api/src/resources/admin-router.test.ts`
- Create: `agent-api/src/resources/filesystem-knowledge-set-ops.ts`
- Create: `agent-api/src/resources/filesystem-knowledge-set-ops.test.ts`
- Modify: `agent-api/src/persistence/knowledge-set-repository.ts`
- Modify: `agent-api/src/persistence/knowledge-set-repository.test.ts`
- Modify: `agent-api/src/persistence/resource-policy-repository.ts`
- Modify: `agent-api/src/persistence/resource-policy-repository.test.ts`
- Modify: `agent-api/src/rbac/seed-system-rbac.ts`
- Modify: `agent-api/src/rbac/seed-system-rbac.test.ts`
- Modify: `agent-api/src/index.ts`
- Modify: `agent-api/src/admin/router.ts`
- Modify: `agent-api/src/admin/router.test.ts`

### Frontend

- Create: `agent-ui/src/features/resources-center/types.ts`
- Create: `agent-ui/src/features/resources-center/api.ts`
- Create: `agent-ui/src/features/resources-center/api.test.ts`
- Create: `agent-ui/src/features/resources-center/ResourceCenterShell.tsx`
- Create: `agent-ui/src/features/resources-center/ResourceCenterShell.test.tsx`
- Create: `agent-ui/src/features/resources-center/WorkspaceDetailView.tsx`
- Create: `agent-ui/src/features/resources-center/WorkspaceDetailView.test.tsx`
- Create: `agent-ui/src/features/resources-center/KnowledgeSetDetailView.tsx`
- Create: `agent-ui/src/features/resources-center/KnowledgeSetDetailView.test.tsx`
- Create: `agent-ui/src/features/resources-center/KnowledgeSetFileTree.tsx`
- Create: `agent-ui/src/features/resources-center/KnowledgeSetFileTree.test.tsx`
- Create: `agent-ui/src/features/resources-center/ResourcePolicyEditor.tsx`
- Create: `agent-ui/src/features/resources-center/ResourcePolicyEditor.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/features/admin/types.ts`
- Modify: `agent-ui/src/styles.css`

### Docs

- Reference: `docs/superpowers/specs/2026-03-30-agent-studio-resource-center-design.md`

## Notes

- Reuse the existing `/api/admin/workspaces`, `/api/admin/knowledge-sets`, and `/api/admin/resource-policies` surface where possible.
- Keep employee runtime semantics unchanged; this plan only adds admin operations.
- All frontend timestamps must render in the admin user's local timezone.
- Filesystem knowledge-set file operations must stay inside the configured root path and must not allow root deletion.
- Filesystem delete / rename require RBAC checks plus explicit UI confirmation.
- Phase one does not add bulk destructive operations or approval flows.

### Task 1: Extend backend resource APIs and RBAC permissions

**Files:**
- Modify: `agent-api/src/resources/admin-router.ts`
- Modify: `agent-api/src/resources/admin-router.test.ts`
- Modify: `agent-api/src/rbac/seed-system-rbac.ts`
- Modify: `agent-api/src/rbac/seed-system-rbac.test.ts`
- Modify: `agent-api/src/admin/router.test.ts`

- [ ] **Step 1: Write failing resource-admin API tests for the missing endpoints**

Add tests in `agent-api/src/resources/admin-router.test.ts` covering:

```ts
it("gets policies for a single workspace resource", async () => {
  const response = await request(app)
    .get(`/api/admin/resources/workspaces/${workspace.id}/policies`)
    .set("Cookie", cookies.create(adminUser.id));

  expect(response.status).toBe(200);
  expect(response.body.policies).toEqual([
    expect.objectContaining({ resourceType: "workspace", resourceId: workspace.id, effect: "allow" })
  ]);
});

it("replaces policies for one knowledge set resource", async () => {
  const response = await request(app)
    .put(`/api/admin/resources/knowledge-sets/${knowledgeSet.id}/policies`)
    .set("Cookie", cookies.create(adminUser.id))
    .send({
      policies: [
        { subjectType: "role", subjectId: "employee", effect: "allow" },
        { subjectType: "department", subjectId: "dept-rd", effect: "deny" }
      ]
    });

  expect(response.status).toBe(200);
  expect(response.body.policies).toHaveLength(2);
});
```

Also add a failing RBAC seed test in `agent-api/src/rbac/seed-system-rbac.test.ts` for:

```ts
expect(permissionKeys).toEqual(expect.arrayContaining([
  "resource_center.read",
  "workspace.read",
  "workspace.write",
  "workspace.disable",
  "knowledge_set.read",
  "knowledge_set.write",
  "knowledge_set.upload",
  "knowledge_set.reindex",
  "knowledge_set.file_manage"
]));
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/resources/admin-router.test.ts src/rbac/seed-system-rbac.test.ts src/admin/router.test.ts
```

Expected: FAIL because the per-resource policy endpoints and permission keys do not exist yet.

- [ ] **Step 3: Implement the missing resource-admin policy endpoints and permission keys**

Update `agent-api/src/resources/admin-router.ts` to add:

- `GET /resources/workspaces/:workspaceId/policies`
- `PUT /resources/workspaces/:workspaceId/policies`
- `GET /resources/knowledge-sets/:knowledgeSetId/policies`
- `PUT /resources/knowledge-sets/:knowledgeSetId/policies`

Each `PUT` should translate request bodies into the existing `replacePoliciesForGroups()` contract, for example:

```ts
const groups = [{ subjectType: "role", subjectId: "employee", resourceType: "workspace" as const }];
const policies = payload.policies.map((policy) => ({
  organizationId: undefined,
  subjectType: policy.subjectType,
  subjectId: policy.subjectId,
  resourceType: "workspace" as const,
  resourceId: req.params.workspaceId,
  effect: policy.effect
}));
```

Update `agent-api/src/rbac/seed-system-rbac.ts` to add the new permission definitions and map them into `admin` / `super_admin` defaults.

- [ ] **Step 4: Re-run the targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/resources/admin-router.test.ts src/rbac/seed-system-rbac.test.ts src/admin/router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the backend resource-policy surface**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/admin-router.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/admin-router.test.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/rbac/seed-system-rbac.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/rbac/seed-system-rbac.test.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin/router.test.ts
git commit -m "feat: extend resource admin policies"
```

### Task 2: Add knowledge-set rebuild and controlled filesystem file operations

**Files:**
- Create: `agent-api/src/resources/filesystem-knowledge-set-ops.ts`
- Create: `agent-api/src/resources/filesystem-knowledge-set-ops.test.ts`
- Modify: `agent-api/src/resources/admin-router.ts`
- Modify: `agent-api/src/resources/admin-router.test.ts`
- Modify: `agent-api/src/persistence/knowledge-set-repository.ts`
- Modify: `agent-api/src/persistence/knowledge-set-repository.test.ts`
- Modify: `agent-api/src/index.ts`

- [ ] **Step 1: Write failing tests for rebuild, rename, and delete operations**

Add repository/service and router tests covering:

```ts
it("rebuilds a filesystem knowledge set inventory from the root path", async () => {
  const items = await ops.scanDirectory(rootPath);
  expect(items).toEqual([
    expect.objectContaining({ relativePath: "guides/readme.md" })
  ]);
});

it("renames a filesystem knowledge set file inside the configured root", async () => {
  await request(app)
    .patch(`/api/admin/knowledge-sets/${knowledgeSet.id}/items`)
    .set("Cookie", cookies.create(adminUser.id))
    .send({ action: "rename", relativePath: "faq/old.md", nextRelativePath: "faq/new.md" });

  expect(await fs.readFile(path.join(rootPath, "faq/new.md"), "utf8")).toContain("content");
});

it("rejects filesystem file operations that escape the configured root", async () => {
  const response = await request(app)
    .delete(`/api/admin/knowledge-sets/${knowledgeSet.id}/items`)
    .set("Cookie", cookies.create(adminUser.id))
    .send({ relativePath: "../outside.txt" });

  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/resources/filesystem-knowledge-set-ops.test.ts src/resources/admin-router.test.ts src/persistence/knowledge-set-repository.test.ts
```

Expected: FAIL because rebuild and filesystem file operations do not exist yet.

- [ ] **Step 3: Implement filesystem knowledge-set operations and rebuild endpoints**

Create `agent-api/src/resources/filesystem-knowledge-set-ops.ts` with focused functions:

```ts
export class FilesystemKnowledgeSetOps {
  async scanDirectory(rootPath: string): Promise<KnowledgeSetStorageItem[]> { /* walk dir recursively */ }
  async deleteFile(rootPath: string, relativePath: string): Promise<void> { /* safe delete */ }
  async renameFile(rootPath: string, relativePath: string, nextRelativePath: string): Promise<void> { /* safe rename */ }
}
```

Use safe path resolution rules:

```ts
const absolute = path.resolve(rootPath, relativePath);
if (!absolute.startsWith(`${path.resolve(rootPath)}${path.sep}`)) {
  throw new Error("knowledge set path escapes root");
}
```

Then update `agent-api/src/resources/admin-router.ts` to add:

- `POST /knowledge-sets/:knowledgeSetId/rebuild`
- `DELETE /knowledge-sets/:knowledgeSetId/items`
- `PATCH /knowledge-sets/:knowledgeSetId/items`

Behavior:
- `rebuild` re-scans either the filesystem root or the managed-upload mount path and then calls `replaceItems()`
- `DELETE` removes one file and refreshes inventory
- `PATCH` with `action: "rename"` renames one file and refreshes inventory
- all three operations write audit/resource-access records

- [ ] **Step 4: Re-run the targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/resources/filesystem-knowledge-set-ops.test.ts src/resources/admin-router.test.ts src/persistence/knowledge-set-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit filesystem operations and rebuild support**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/filesystem-knowledge-set-ops.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/filesystem-knowledge-set-ops.test.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/admin-router.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/resources/admin-router.test.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/knowledge-set-repository.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/knowledge-set-repository.test.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts
git commit -m "feat: add resource filesystem operations"
```

### Task 3: Add the resource center frontend shell and typed APIs

**Files:**
- Create: `agent-ui/src/features/resources-center/types.ts`
- Create: `agent-ui/src/features/resources-center/api.ts`
- Create: `agent-ui/src/features/resources-center/api.test.ts`
- Create: `agent-ui/src/features/resources-center/ResourceCenterShell.tsx`
- Create: `agent-ui/src/features/resources-center/ResourceCenterShell.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/features/admin/types.ts`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing frontend tests for the new resource-center shell**

Add tests like:

```tsx
it("navigates from the admin shell into the resource center", async () => {
  render(<AdminShell />);
  fireEvent.click(await screen.findByRole("tab", { name: "资源配置中心" }));
  expect(await screen.findByText("资源配置中心")).toBeTruthy();
  expect(await screen.findByRole("tab", { name: "工作区" })).toBeTruthy();
});

it("loads workspaces and knowledge sets through the typed resource-center API", async () => {
  mockedFetchResourceCenterData.mockResolvedValue({ workspaces: [...], knowledgeSets: [...] });
  render(<ResourceCenterShell />);
  expect(await screen.findByText("docs-workspace")).toBeTruthy();
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/resources-center/api.test.ts src/features/resources-center/ResourceCenterShell.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
```

Expected: FAIL because the resource-center feature files do not exist yet.

- [ ] **Step 3: Implement typed APIs and the shell container**

Create `agent-ui/src/features/resources-center/types.ts` with explicit response/input types for:

- workspaces
- knowledge sets
- workspace bindings
- knowledge-set items
- resource policies

Create `agent-ui/src/features/resources-center/api.ts` functions for:

```ts
fetchWorkspaces()
createWorkspace(input)
updateWorkspace(id, input)
fetchKnowledgeSets()
createKnowledgeSet(input)
updateKnowledgeSet(id, input)
fetchWorkspaceKnowledgeSetBindings(workspaceId)
putWorkspaceKnowledgeSetBindings(workspaceId, bindings)
fetchResourcePolicies(resourceType, resourceId)
putResourcePolicies(resourceType, resourceId, policies)
fetchKnowledgeSetItems(knowledgeSetId)
uploadKnowledgeSetFiles(knowledgeSetId, files)
uploadKnowledgeSetArchive(knowledgeSetId, archiveName, file)
rebuildKnowledgeSet(knowledgeSetId)
deleteKnowledgeSetItem(knowledgeSetId, relativePath)
renameKnowledgeSetItem(knowledgeSetId, relativePath, nextRelativePath)
```

Then build `ResourceCenterShell.tsx` with:

- resource-type tabs for `工作区` and `资料集`
- search field
- status / type filters
- left-side resource list
- create buttons
- right-side detail mount points

Mount it in `AdminShell` under a new `AdminSection` value such as `resources`, and add the nav item in `AdminNav`.

- [ ] **Step 4: Re-run the targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/resources-center/api.test.ts src/features/resources-center/ResourceCenterShell.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the resource-center shell**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/types.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/api.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/api.test.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/ResourceCenterShell.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/ResourceCenterShell.test.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminNav.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminNav.test.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminShell.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/AdminShell.test.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/admin/types.ts /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css
git commit -m "feat: add resource center shell"
```

### Task 4: Implement workspace detail, bindings, and policy editing

**Files:**
- Create: `agent-ui/src/features/resources-center/WorkspaceDetailView.tsx`
- Create: `agent-ui/src/features/resources-center/WorkspaceDetailView.test.tsx`
- Create: `agent-ui/src/features/resources-center/ResourcePolicyEditor.tsx`
- Create: `agent-ui/src/features/resources-center/ResourcePolicyEditor.test.tsx`
- Modify: `agent-ui/src/features/resources-center/ResourceCenterShell.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing tests for workspace detail editing**

Add tests such as:

```tsx
it("saves workspace metadata and bindings from the detail panel", async () => {
  render(<WorkspaceDetailView workspaceId="workspace-1" />);
  fireEvent.change(await screen.findByLabelText("工作区名称"), { target: { value: "Docs Updated" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Policies default" }));
  fireEvent.click(screen.getByRole("button", { name: "保存工作区" }));
  await waitFor(() => expect(mockedUpdateWorkspace).toHaveBeenCalled());
  await waitFor(() => expect(mockedPutWorkspaceKnowledgeSetBindings).toHaveBeenCalled());
});

it("edits role, department, and user allow/deny policies for a workspace", async () => {
  render(<ResourcePolicyEditor resourceType="workspace" resourceId="workspace-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "新增授权规则" }));
  fireEvent.change(screen.getByLabelText("主体类型"), { target: { value: "department" } });
  fireEvent.change(screen.getByLabelText("主体 ID"), { target: { value: "dept-rd" } });
  fireEvent.change(screen.getByLabelText("效果"), { target: { value: "deny" } });
  fireEvent.click(screen.getByRole("button", { name: "保存授权" }));
  await waitFor(() => expect(mockedPutResourcePolicies).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/resources-center/WorkspaceDetailView.test.tsx src/features/resources-center/ResourcePolicyEditor.test.tsx
```

Expected: FAIL because these components do not exist yet.

- [ ] **Step 3: Implement workspace detail and policy editor components**

Build `WorkspaceDetailView.tsx` with:

- metadata form (`name`, `slug`, `description`, `rootPath`, `status`)
- embedded binding section showing knowledge sets grouped by `default` / `optional`
- save action that calls both `updateWorkspace()` and `putWorkspaceKnowledgeSetBindings()`
- embedded `ResourcePolicyEditor`

Build `ResourcePolicyEditor.tsx` as a reusable editor for:

- listing current policies
- adding rules by `subjectType`, `subjectId`, `effect`
- removing rules
- saving the whole per-resource policy set through `putResourcePolicies()`

Keep timestamps and summaries rendered via `toLocaleString()` or `Intl.DateTimeFormat(undefined, ...)`.

- [ ] **Step 4: Re-run the targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/resources-center/WorkspaceDetailView.test.tsx src/features/resources-center/ResourcePolicyEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit workspace detail and policy editing**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/WorkspaceDetailView.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/WorkspaceDetailView.test.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/ResourcePolicyEditor.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/ResourcePolicyEditor.test.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/ResourceCenterShell.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css
git commit -m "feat: add workspace resource management"
```

### Task 5: Implement knowledge-set detail, file tree, uploads, and file actions

**Files:**
- Create: `agent-ui/src/features/resources-center/KnowledgeSetDetailView.tsx`
- Create: `agent-ui/src/features/resources-center/KnowledgeSetDetailView.test.tsx`
- Create: `agent-ui/src/features/resources-center/KnowledgeSetFileTree.tsx`
- Create: `agent-ui/src/features/resources-center/KnowledgeSetFileTree.test.tsx`
- Modify: `agent-ui/src/features/resources-center/ResourceCenterShell.tsx`
- Modify: `agent-ui/src/features/resources-center/ResourcePolicyEditor.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing tests for the knowledge-set file tree and operations**

Add tests such as:

```tsx
it("renders knowledge-set items as a directory tree with local timestamps", async () => {
  render(<KnowledgeSetFileTree items={[{ relativePath: "guide/readme.md", updatedAt: "2026-03-30T00:00:00.000Z" } as any]} />);
  expect(await screen.findByText("guide")).toBeTruthy();
  expect(await screen.findByText("readme.md")).toBeTruthy();
});

it("uploads files, rebuilds inventory, and confirms before deleting a filesystem file", async () => {
  window.confirm = vi.fn(() => true);
  render(<KnowledgeSetDetailView knowledgeSetId="ks-1" />);
  fireEvent.change(await screen.findByLabelText("上传文件"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "重建文件清单" }));
  fireEvent.click(screen.getByRole("button", { name: "删除 faq.md" }));
  await waitFor(() => expect(mockedDeleteKnowledgeSetItem).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/resources-center/KnowledgeSetDetailView.test.tsx src/features/resources-center/KnowledgeSetFileTree.test.tsx
```

Expected: FAIL because these components do not exist yet.

- [ ] **Step 3: Implement knowledge-set detail and the file tree**

Build `KnowledgeSetFileTree.tsx` to transform `relativePath` strings into nested nodes, for example:

```ts
function buildTree(items: KnowledgeSetItem[]) {
  const root = new Map<string, TreeNode>();
  for (const item of items) {
    const parts = item.relativePath.split("/");
    // build nested nodes
  }
  return [...root.values()];
}
```

Build `KnowledgeSetDetailView.tsx` with:

- metadata form for `name`, `slug`, `description`, `status`, `sourceType`, `rootPath` / `storageKey`
- file upload input for managed uploads
- archive upload action for managed uploads
- rebuild button for both source types
- embedded `KnowledgeSetFileTree`
- single-file delete and rename actions
- explicit `window.confirm()` checks before delete / rename on filesystem-backed knowledge sets
- embedded `ResourcePolicyEditor`

The component must branch behavior by `sourceType` so:
- `managed_upload` shows upload controls
- `filesystem` shows controlled file actions only

- [ ] **Step 4: Re-run the targeted tests to verify they pass**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/resources-center/KnowledgeSetDetailView.test.tsx src/features/resources-center/KnowledgeSetFileTree.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit knowledge-set detail and file operations UI**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/KnowledgeSetDetailView.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/KnowledgeSetDetailView.test.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/KnowledgeSetFileTree.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/KnowledgeSetFileTree.test.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/ResourceCenterShell.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/resources-center/ResourcePolicyEditor.tsx /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/styles.css
git commit -m "feat: add knowledge set resource management"
```

### Task 6: Run full verification for the resource center

**Files:**
- Verify only

- [ ] **Step 1: Run backend focused verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/resources/admin-router.test.ts src/resources/filesystem-knowledge-set-ops.test.ts src/persistence/knowledge-set-repository.test.ts src/rbac/seed-system-rbac.test.ts src/admin/router.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend focused verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/resources-center/api.test.ts src/features/resources-center/ResourceCenterShell.test.tsx src/features/resources-center/WorkspaceDetailView.test.tsx src/features/resources-center/KnowledgeSetDetailView.test.tsx src/features/resources-center/KnowledgeSetFileTree.test.tsx src/features/resources-center/ResourcePolicyEditor.test.tsx src/features/admin/AdminShell.test.tsx src/features/admin/AdminNav.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full backend and frontend verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test && npm run build

cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test && npm run build
```

Expected: PASS. Vite bundle-size warnings may remain non-blocking if build succeeds.

- [ ] **Step 4: Commit any final verification fixes**

```bash
git add /Users/like/Desktop/baicells/Trae/agent-studio/agent-api /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
git commit -m "fix: align resource center verification issues"
```

Only create this commit if verification exposes real issues that require code changes.
