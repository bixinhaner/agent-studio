# Workspace And Knowledge Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class workspace and knowledge-set management with role/department/user authorization, filesystem and managed-upload knowledge-set types, admin management APIs, and portal resource selection.

**Architecture:** Extend the Prisma data model with workspace, knowledge-set, binding, and policy tables. Add repository and policy services in `agent-api`, expose dedicated admin and portal resource APIs, and keep runtime compatibility by translating selected knowledge sets into `additionalDirectories`. Use a storage abstraction for managed uploads with a filesystem adapter first.

**Tech Stack:** TypeScript, Express, React, Vite, assistant-ui, Prisma ORM, PostgreSQL, Vitest, Supertest, filesystem-backed storage adapter, zip extraction.

---

## File Structure

### Backend files

- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/20260327xxxxxx_add_workspace_knowledge_sets/migration.sql`
- Create: `agent-api/src/persistence/workspace-repository.ts`
- Create: `agent-api/src/persistence/workspace-repository.test.ts`
- Create: `agent-api/src/persistence/knowledge-set-repository.ts`
- Create: `agent-api/src/persistence/knowledge-set-repository.test.ts`
- Create: `agent-api/src/persistence/resource-policy-repository.ts`
- Create: `agent-api/src/persistence/resource-policy-repository.test.ts`
- Create: `agent-api/src/resources/policy-service.ts`
- Create: `agent-api/src/resources/policy-service.test.ts`
- Create: `agent-api/src/resources/storage/knowledge-set-storage.ts`
- Create: `agent-api/src/resources/storage/filesystem-knowledge-set-storage.ts`
- Create: `agent-api/src/resources/storage/filesystem-knowledge-set-storage.test.ts`
- Create: `agent-api/src/resources/admin-router.ts`
- Create: `agent-api/src/resources/admin-router.test.ts`
- Create: `agent-api/src/resources/portal-router.ts`
- Create: `agent-api/src/resources/portal-router.test.ts`
- Modify: `agent-api/src/app-routes.ts`
- Modify: `agent-api/src/index.ts`
- Modify: `agent-api/src/portal/router.ts`
- Modify: `agent-api/src/portal/runtime-options.ts`
- Modify: `agent-api/src/config.ts`

### Frontend files

- Create: `agent-ui/src/features/resources/api.ts`
- Create: `agent-ui/src/features/resources/types.ts`
- Create: `agent-ui/src/features/resources/KnowledgeSetPicker.tsx`
- Create: `agent-ui/src/features/resources/KnowledgeSetPicker.test.tsx`
- Modify: `agent-ui/src/features/portal/PortalShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/App.test.tsx`
- Modify: `agent-ui/src/styles.css`

### Docs

- Reference: `docs/superpowers/specs/2026-03-27-agent-studio-workspace-knowledge-set-design.md`

### Task 1: Add Prisma models and migration for workspaces, knowledge sets, items, bindings, and policies

**Files:**
- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/20260327xxxxxx_add_workspace_knowledge_sets/migration.sql`

- [ ] **Step 1: Run a failing schema diff check against the current Prisma model**

Run:
- `cd agent-api && npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE \"(workspaces|knowledge_sets|knowledge_set_items|workspace_knowledge_sets|resource_policies)\"'`

Expected:
- command exits non-zero because the current schema does not emit those tables yet

- [ ] **Step 2: Extend the Prisma schema with resource models**

```prisma
model Workspace {
  id          String   @id @default(cuid())
  organizationId String? @map("organization_id")
  name        String
  slug        String   @unique
  description String?
  status      String   @default("active")
  sourceType  String   @map("source_type")
  rootPath    String?  @map("root_path")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  bindings    WorkspaceKnowledgeSet[]

  @@map("workspaces")
}

model KnowledgeSet {
  id          String   @id @default(cuid())
  organizationId String? @map("organization_id")
  name        String
  slug        String   @unique
  description String?
  status      String   @default("active")
  sourceType  String   @map("source_type")
  rootPath    String?  @map("root_path")
  storageKey  String?  @map("storage_key")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  items       KnowledgeSetItem[]
  bindings    WorkspaceKnowledgeSet[]

  @@map("knowledge_sets")
}

model KnowledgeSetItem {
  id               String   @id @default(cuid())
  knowledgeSetId   String   @map("knowledge_set_id")
  kind             String
  relativePath     String   @map("relative_path")
  displayName      String   @map("display_name")
  mimeType         String?  @map("mime_type")
  sizeBytes        BigInt?  @map("size_bytes")
  checksum         String?
  sourceArchiveName String? @map("source_archive_name")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  knowledgeSet     KnowledgeSet @relation(fields: [knowledgeSetId], references: [id], onDelete: Cascade)

  @@index([knowledgeSetId, relativePath])
  @@unique([knowledgeSetId, relativePath])
  @@map("knowledge_set_items")
}

model WorkspaceKnowledgeSet {
  id             String   @id @default(cuid())
  workspaceId    String   @map("workspace_id")
  knowledgeSetId String   @map("knowledge_set_id")
  mountType      String   @map("mount_type")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  workspace      Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  knowledgeSet   KnowledgeSet @relation(fields: [knowledgeSetId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, knowledgeSetId])
  @@map("workspace_knowledge_sets")
}

model ResourcePolicy {
  id             String   @id @default(cuid())
  organizationId String?  @map("organization_id")
  subjectType    String   @map("subject_type")
  subjectId      String   @map("subject_id")
  resourceType   String   @map("resource_type")
  resourceId     String   @map("resource_id")
  effect         String
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@index([subjectType, subjectId])
  @@index([resourceType, resourceId])
  @@map("resource_policies")
}
```

- [ ] **Step 3: Add the SQL migration**

```sql
CREATE TABLE "workspaces" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "source_type" TEXT NOT NULL,
  "root_path" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "knowledge_sets" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "source_type" TEXT NOT NULL,
  "root_path" TEXT,
  "storage_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "knowledge_set_items" (
  "id" TEXT PRIMARY KEY,
  "knowledge_set_id" TEXT NOT NULL REFERENCES "knowledge_sets"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "relative_path" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "mime_type" TEXT,
  "size_bytes" BIGINT,
  "checksum" TEXT,
  "source_archive_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("knowledge_set_id", "relative_path")
);

CREATE TABLE "workspace_knowledge_sets" (
  "id" TEXT PRIMARY KEY,
  "workspace_id" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "knowledge_set_id" TEXT NOT NULL REFERENCES "knowledge_sets"("id") ON DELETE CASCADE,
  "mount_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("workspace_id", "knowledge_set_id")
);

CREATE TABLE "resource_policies" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "subject_type" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "effect" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 4: Run Prisma generation and re-run the schema diff check**

Run:
- `cd agent-api && npm run prisma:generate`
- `cd agent-api && npm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg 'CREATE TABLE \"(workspaces|knowledge_sets|knowledge_set_items|workspace_knowledge_sets|resource_policies)\"'`

Expected:
- Prisma client generation passes
- schema diff check prints the five `CREATE TABLE` statements and exits zero

- [ ] **Step 5: Commit the schema and migration**

```bash
git add agent-api/prisma
git commit -m "feat: add workspace and knowledge set schema"
```

### Task 2: Implement workspace, knowledge-set, and binding repositories

**Files:**
- Create: `agent-api/src/persistence/workspace-repository.ts`
- Create: `agent-api/src/persistence/knowledge-set-repository.ts`
- Create: `agent-api/src/persistence/workspace-repository.test.ts`
- Create: `agent-api/src/persistence/knowledge-set-repository.test.ts`

- [ ] **Step 1: Expand the failing repository tests for workspace, knowledge set, item refresh, and bindings**

```ts
it("replaces all workspace bindings in one call", async () => {
  const repo = createKnowledgeSetRepositoryForTest();
  const workspace = await repo.createWorkspace({ name: "Docs", slug: "docs", sourceType: "filesystem", rootPath: "/srv/docs" });
  const ksA = await repo.createKnowledgeSet({ name: "FAQ", slug: "faq", sourceType: "filesystem", rootPath: "/srv/faq" });
  const ksB = await repo.createKnowledgeSet({ name: "Runbooks", slug: "runbooks", sourceType: "filesystem", rootPath: "/srv/runbooks" });

  await repo.replaceWorkspaceBindings(workspace.id, [
    { knowledgeSetId: ksA.id, mountType: "default" },
    { knowledgeSetId: ksB.id, mountType: "optional" }
  ]);

  expect(await repo.listWorkspaceBindings(workspace.id)).toEqual([
    expect.objectContaining({ knowledgeSetId: ksA.id, mountType: "default" }),
    expect.objectContaining({ knowledgeSetId: ksB.id, mountType: "optional" })
  ]);
});
```

- [ ] **Step 2: Run repository tests and verify failure**

Run: `cd agent-api && npm exec -- vitest run src/persistence/workspace-repository.test.ts src/persistence/knowledge-set-repository.test.ts`
Expected: FAIL with missing repository methods.

- [ ] **Step 3: Implement workspace repository**

```ts
export class WorkspaceRepository {
  constructor(private readonly db: WorkspaceRepositoryDb) {}

  async create(input: WorkspaceCreateInput): Promise<WorkspaceRecord> {
    const row = await this.db.workspace.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        status: input.status,
        sourceType: input.sourceType,
        rootPath: input.rootPath ?? null
      }
    });
    return mapWorkspace(row);
  }
}
```

- [ ] **Step 4: Implement knowledge-set repository with item and binding helpers**

```ts
export class KnowledgeSetRepository {
  constructor(private readonly db: KnowledgeSetRepositoryDb) {}

  async replaceWorkspaceBindings(workspaceId: string, bindings: WorkspaceKnowledgeSetBindingInput[]) {
    await this.db.workspaceKnowledgeSet.deleteMany({ where: { workspaceId } });
    if (bindings.length === 0) return [];
    await this.db.workspaceKnowledgeSet.createMany({
      data: bindings.map((binding) => ({
        workspaceId,
        knowledgeSetId: binding.knowledgeSetId,
        mountType: binding.mountType
      }))
    });
    return await this.listWorkspaceBindings(workspaceId);
  }

  async replaceItems(knowledgeSetId: string, items: KnowledgeSetItemInput[]) {
    await this.db.knowledgeSetItem.deleteMany({ where: { knowledgeSetId } });
    if (items.length === 0) return [];
    await this.db.knowledgeSetItem.createMany({
      data: items.map((item) => ({
        knowledgeSetId,
        kind: item.kind,
        relativePath: item.relativePath,
        displayName: item.displayName,
        mimeType: item.mimeType ?? null,
        sizeBytes: item.sizeBytes ?? null,
        checksum: item.checksum ?? null,
        sourceArchiveName: item.sourceArchiveName ?? null
      }))
    });
    return await this.listItems(knowledgeSetId);
  }
}
```

- [ ] **Step 5: Run repository tests and make them pass**

Run: `cd agent-api && npm exec -- vitest run src/persistence/workspace-repository.test.ts src/persistence/knowledge-set-repository.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit repository layer**

```bash
git add agent-api/src/persistence/workspace-repository.ts agent-api/src/persistence/knowledge-set-repository.ts agent-api/src/persistence/workspace-repository.test.ts agent-api/src/persistence/knowledge-set-repository.test.ts
git commit -m "feat: add workspace and knowledge set repositories"
```

### Task 3: Implement resource-policy repository and effective access policy service

**Files:**
- Create: `agent-api/src/persistence/resource-policy-repository.ts`
- Create: `agent-api/src/persistence/resource-policy-repository.test.ts`
- Create: `agent-api/src/resources/policy-service.ts`
- Create: `agent-api/src/resources/policy-service.test.ts`

- [ ] **Step 1: Write failing policy tests for role, department, user, and deny precedence**

```ts
it("lets deny override allow across scopes", async () => {
  const policies = createPolicyServiceForTest();

  await policies.replacePolicies([
    { subjectType: "role", subjectId: "employee", resourceType: "workspace", resourceId: "ws-1", effect: "allow" },
    { subjectType: "department", subjectId: "dept-1", resourceType: "workspace", resourceId: "ws-1", effect: "allow" },
    { subjectType: "user", subjectId: "user-1", resourceType: "workspace", resourceId: "ws-1", effect: "deny" }
  ]);

  const visible = await policies.filterAllowedResources({
    userId: "user-1",
    roleIds: ["employee"],
    departmentIds: ["dept-1"],
    resourceType: "workspace",
    candidateIds: ["ws-1"]
  });

  expect(visible).toEqual([]);
});
```

- [ ] **Step 2: Run policy tests and confirm failure**

Run: `cd agent-api && npm exec -- vitest run src/persistence/resource-policy-repository.test.ts src/resources/policy-service.test.ts`
Expected: FAIL because repository/service do not exist.

- [ ] **Step 3: Implement repository and policy service**

```ts
export class PolicyService {
  constructor(private readonly policies: ResourcePolicyRepository) {}

  async filterAllowedResources(input: {
    userId: string;
    roleIds: string[];
    departmentIds: string[];
    resourceType: "workspace" | "knowledge_set";
    candidateIds: string[];
  }): Promise<string[]> {
    const rows = await this.policies.listForSubjects({
      resourceType: input.resourceType,
      subjectRefs: [
        ...input.roleIds.map((id) => ({ subjectType: "role" as const, subjectId: id })),
        ...input.departmentIds.map((id) => ({ subjectType: "department" as const, subjectId: id })),
        { subjectType: "user" as const, subjectId: input.userId }
      ]
    });

    return input.candidateIds.filter((resourceId) => {
      const matched = rows.filter((row) => row.resourceId === resourceId);
      if (matched.some((row) => row.effect === "deny")) return false;
      return matched.some((row) => row.effect === "allow");
    });
  }
}
```

- [ ] **Step 4: Run policy tests and verify they pass**

Run: `cd agent-api && npm exec -- vitest run src/persistence/resource-policy-repository.test.ts src/resources/policy-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit policy layer**

```bash
git add agent-api/src/persistence/resource-policy-repository.ts agent-api/src/persistence/resource-policy-repository.test.ts agent-api/src/resources/policy-service.ts agent-api/src/resources/policy-service.test.ts
git commit -m "feat: add resource policy evaluation"
```

### Task 4: Add managed-upload storage abstraction and filesystem adapter

**Files:**
- Create: `agent-api/src/resources/storage/knowledge-set-storage.ts`
- Create: `agent-api/src/resources/storage/filesystem-knowledge-set-storage.ts`
- Create: `agent-api/src/resources/storage/filesystem-knowledge-set-storage.test.ts`
- Modify: `agent-api/src/config.ts`

- [ ] **Step 1: Write failing storage tests for batch upload and zip extraction**

```ts
it("expands a zip archive and returns a normalized item inventory", async () => {
  const storage = createFilesystemKnowledgeSetStorageForTest();

  const result = await storage.extractArchive({
    knowledgeSetId: "ks-1",
    archiveName: "docs.zip",
    buffer: await readFixture("docs.zip")
  });

  expect(result.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ relativePath: "guide/readme.md", kind: "file" }),
      expect.objectContaining({ relativePath: "faq/usage.txt", kind: "file" })
    ])
  );
});
```

- [ ] **Step 2: Run storage tests and confirm failure**

Run: `cd agent-api && npm exec -- vitest run src/resources/storage/filesystem-knowledge-set-storage.test.ts`
Expected: FAIL because storage adapter does not exist.

- [ ] **Step 3: Add config for managed knowledge-set root**

```ts
const schema = z.object({
  KNOWLEDGE_SET_STORAGE_ROOT: z.string().default("./temp/knowledge-sets")
});

const knowledgeSetStorageRoot = path.resolve(process.cwd(), env.KNOWLEDGE_SET_STORAGE_ROOT);
```

- [ ] **Step 4: Implement the storage interface and filesystem adapter**

```ts
export interface KnowledgeSetStorage {
  saveFiles(input: { knowledgeSetId: string; files: Array<{ name: string; buffer: Buffer; mimeType?: string }> }): Promise<KnowledgeSetStorageResult>;
  extractArchive(input: { knowledgeSetId: string; archiveName: string; buffer: Buffer }): Promise<KnowledgeSetStorageResult>;
  resolveReadableMountPath(knowledgeSetId: string): string;
}
```

```ts
export class FilesystemKnowledgeSetStorage implements KnowledgeSetStorage {
  constructor(private readonly rootDir: string) {}

  resolveReadableMountPath(knowledgeSetId: string): string {
    return path.join(this.rootDir, knowledgeSetId);
  }
}
```

- [ ] **Step 5: Run storage tests and verify pass**

Run: `cd agent-api && npm exec -- vitest run src/resources/storage/filesystem-knowledge-set-storage.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit storage layer**

```bash
git add agent-api/src/resources/storage agent-api/src/config.ts agent-api/src/resources/storage/filesystem-knowledge-set-storage.test.ts
git commit -m "feat: add knowledge set storage adapter"
```

### Task 5: Add admin APIs for workspaces, knowledge sets, bindings, and policies

**Files:**
- Create: `agent-api/src/resources/admin-router.ts`
- Create: `agent-api/src/resources/admin-router.test.ts`
- Modify: `agent-api/src/app-routes.ts`
- Modify: `agent-api/src/index.ts`

- [ ] **Step 1: Write failing admin API tests for workspace list, knowledge-set upload, and bindings**

```ts
it("uploads files into a managed knowledge set and refreshes items", async () => {
  const { app, cookies, adminUser } = buildResourcesAdminApp();
  const knowledgeSet = await seedManagedKnowledgeSet();

  const response = await request(app)
    .post(`/api/admin/knowledge-sets/${knowledgeSet.id}/files`)
    .set("Cookie", cookies.create(adminUser.id))
    .attach("files", fixturePath("faq.md"))
    .attach("files", fixturePath("guide.txt"));

  expect(response.status).toBe(200);
  expect(response.body.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ relative_path: "faq.md" }),
      expect.objectContaining({ relative_path: "guide.txt" })
    ])
  );
});
```

- [ ] **Step 2: Run admin API tests and confirm failure**

Run: `cd agent-api && npm exec -- vitest run src/resources/admin-router.test.ts`
Expected: FAIL because admin resource router does not exist.

- [ ] **Step 3: Implement admin resource router**

```ts
router.get("/workspaces", async (_req, res) => {
  res.json({ workspaces: await workspaces.list() });
});

router.post("/knowledge-sets/:knowledgeSetId/archive", uploadRawParser, async (req, res) => {
  const result = await storage.extractArchive({
    knowledgeSetId: req.params.knowledgeSetId,
    archiveName: req.header("X-Archive-Name") || "archive.zip",
    buffer: req.body as Buffer
  });
  await knowledgeSets.replaceItems(req.params.knowledgeSetId, result.items);
  res.json({ items: await knowledgeSets.listItems(req.params.knowledgeSetId) });
});
```

- [ ] **Step 4: Register the admin resource router from `index.ts` and `app-routes.ts`**

```ts
app.use("/api/admin", requireCurrentUser, requireRole("admin"), adminRouter, resourcesAdminRouter);
```

- [ ] **Step 5: Run admin API tests and verify pass**

Run: `cd agent-api && npm exec -- vitest run src/resources/admin-router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit admin APIs**

```bash
git add agent-api/src/resources/admin-router.ts agent-api/src/resources/admin-router.test.ts agent-api/src/app-routes.ts agent-api/src/index.ts
git commit -m "feat: add workspace and knowledge set admin apis"
```

### Task 6: Add portal resource API with effective authorization and workspace bindings

**Files:**
- Create: `agent-api/src/resources/portal-router.ts`
- Create: `agent-api/src/resources/portal-router.test.ts`
- Modify: `agent-api/src/index.ts`
- Modify: `agent-api/src/portal/router.ts`

- [ ] **Step 1: Write failing portal API tests for authorized workspaces, default knowledge sets, and optional selections**

```ts
it("returns only authorized workspace resources for the signed-in employee", async () => {
  const { app, cookies, user } = buildPortalResourcesApp();

  const response = await request(app)
    .get("/api/portal/resources")
    .set("Cookie", cookies.create(user.id));

  expect(response.status).toBe(200);
  expect(response.body.workspaces).toEqual([
    expect.objectContaining({
      id: "ws-docs",
      default_knowledge_sets: [expect.objectContaining({ id: "ks-faq" })],
      optional_knowledge_sets: [expect.objectContaining({ id: "ks-runbook" })]
    })
  ]);
});
```

- [ ] **Step 2: Run portal API tests and confirm failure**

Run: `cd agent-api && npm exec -- vitest run src/resources/portal-router.test.ts`
Expected: FAIL because portal resources router does not exist.

- [ ] **Step 3: Implement portal resource router and policy composition**

```ts
router.get("/resources", async (req, res) => {
  const currentUser = req.currentUser!;
  const departmentIds = await departments.listIdsForUser(currentUser.id);
  const workspaces = await resourceService.listPortalResources({
    userId: currentUser.id,
    roleIds: [currentUser.role ?? "employee"],
    departmentIds
  });
  res.json({ workspaces });
});
```

- [ ] **Step 4: Keep `/api/portal/runtime-options` stable while adding the new resource endpoint**

```ts
app.use("/api/portal", requireCurrentUser, portalRouter, resourcesPortalRouter);
```

- [ ] **Step 5: Run portal API tests and verify pass**

Run: `cd agent-api && npm exec -- vitest run src/resources/portal-router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit portal resource API**

```bash
git add agent-api/src/resources/portal-router.ts agent-api/src/resources/portal-router.test.ts agent-api/src/portal/router.ts agent-api/src/index.ts
git commit -m "feat: add portal workspace and knowledge set resources"
```

### Task 7: Integrate portal UI for workspace and optional knowledge-set selection

**Files:**
- Create: `agent-ui/src/features/resources/api.ts`
- Create: `agent-ui/src/features/resources/types.ts`
- Create: `agent-ui/src/features/resources/KnowledgeSetPicker.tsx`
- Create: `agent-ui/src/features/resources/KnowledgeSetPicker.test.tsx`
- Modify: `agent-ui/src/features/portal/PortalShell.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing portal UI tests for default and optional knowledge-set rendering**

```tsx
it("shows default knowledge sets and lets the user add optional ones", async () => {
  mockedApi
    .mockResolvedValueOnce({
      workspaces: [
        {
          id: "ws-docs",
          label: "Docs",
          is_default: true,
          default_knowledge_sets: [{ id: "ks-faq", label: "FAQ" }],
          optional_knowledge_sets: [{ id: "ks-runbook", label: "Runbooks" }]
        }
      ]
    })
    .mockResolvedValueOnce({ modes: [{ id: "standard", label: "通用助手" }], workspaces: [], canUpload: true, defaults: { mode: "standard", workspace: "ws-docs" } });

  render(<PortalShell />);

  expect(await screen.findByText("FAQ")).toBeTruthy();
  expect(screen.getByLabelText("Runbooks")).toBeTruthy();
});
```

- [ ] **Step 2: Run the targeted UI test and confirm failure**

Run: `cd agent-ui && npm exec -- vitest run src/features/resources/KnowledgeSetPicker.test.tsx`
Expected: FAIL because resource picker components and APIs do not exist.

- [ ] **Step 3: Add portal resource API client and types**

```ts
export async function fetchPortalResources(): Promise<PortalResourcesResponse> {
  return await api<PortalResourcesResponse>("/api/portal/resources");
}
```

- [ ] **Step 4: Add a focused knowledge-set picker component**

```tsx
export function KnowledgeSetPicker(props: {
  defaultKnowledgeSets: KnowledgeSetOption[];
  optionalKnowledgeSets: KnowledgeSetOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <section className="knowledge-set-panel">
      <h3>资料集</h3>
      <ul>{props.defaultKnowledgeSets.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
      {props.optionalKnowledgeSets.map((item) => (
        <label key={item.id}>
          <input type="checkbox" checked={props.selectedIds.includes(item.id)} onChange={() => toggle(item.id)} />
          {item.label}
        </label>
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Integrate portal resources into `PortalShell.tsx`**

```ts
const [portalResources, setPortalResources] = useState<PortalResourcesResponse | null>(null);
const [selectedKnowledgeSetIds, setSelectedKnowledgeSetIds] = useState<string[]>([]);
```

```ts
const selectedWorkspaceResources = portalResources?.workspaces.find((item) => item.id === appliedConfig.workspace);
const defaultKnowledgeSets = selectedWorkspaceResources?.default_knowledge_sets ?? [];
const optionalKnowledgeSets = selectedWorkspaceResources?.optional_knowledge_sets ?? [];
```

- [ ] **Step 6: Run portal UI tests and frontend suite**

Run:
- `cd agent-ui && npm exec -- vitest run src/features/resources/KnowledgeSetPicker.test.tsx`
- `cd agent-ui && npm test`

Expected: PASS.

- [ ] **Step 7: Commit portal UI changes**

```bash
git add agent-ui/src/features/resources agent-ui/src/features/portal/PortalShell.tsx agent-ui/src/styles.css
git commit -m "feat: add portal knowledge set selection"
```

### Task 8: Send selected knowledge sets through session creation while preserving runtime compatibility

**Files:**
- Modify: `agent-api/src/index.ts`
- Modify: `agent-ui/src/features/portal/PortalShell.tsx`
- Test: `agent-api/src/resources/portal-router.test.ts`
- Test: `agent-ui/src/features/resources/KnowledgeSetPicker.test.tsx`

- [ ] **Step 1: Write failing tests for translating selected knowledge sets into runtime `additionalDirectories`**

```ts
it("adds selected knowledge set mount paths to codex_run_config.additionalDirectories", async () => {
  const runtimeConfig = buildRuntimeConfigForTest({
    workspacePath: "/srv/docs",
    knowledgeSetPaths: ["/srv/faq", "/managed/ks-runbooks"]
  });

  expect(runtimeConfig.additionalDirectories).toEqual(["/srv/faq", "/managed/ks-runbooks"]);
});
```

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run:
- `cd agent-api && npm exec -- vitest run src/resources/portal-router.test.ts`
- `cd agent-ui && npm exec -- vitest run src/features/resources/KnowledgeSetPicker.test.tsx`

Expected: FAIL because selected knowledge sets are not yet threaded through session creation.

- [ ] **Step 3: Extend the frontend session request payload**

```ts
json: {
  model: cfg.model,
  reasoning_effort: cfg.reasoningEffort,
  workspace: cfg.workspace,
  knowledge_set_ids: selectedKnowledgeSetIds,
  codex_run_config: buildCodexRunConfig(cfg, runtimeModeRef.current)
}
```

- [ ] **Step 4: Resolve selected knowledge sets server-side and merge them into `additionalDirectories`**

```ts
const selectedKnowledgeSets = await resourceService.resolveSelectedKnowledgeSets({
  userId,
  workspaceId: requestedWorkspaceId,
  knowledgeSetIds: input.knowledge_set_ids ?? []
});
const codexRunConfig = mergeKnowledgeSetMounts(input.codex_run_config, selectedKnowledgeSets.mountPaths);
```

- [ ] **Step 5: Run backend and frontend verification**

Run:
- `cd agent-api && npm test && npm run build`
- `cd agent-ui && npm test && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit runtime integration**

```bash
git add agent-api/src/index.ts agent-ui/src/features/portal/PortalShell.tsx
git commit -m "feat: mount selected knowledge sets in runtime sessions"
```

## Self-Review Checklist

- Spec coverage:
  - workspace and knowledge-set models are covered by Tasks 1 and 2.
  - three-layer authorization is covered by Task 3.
  - managed-upload storage and archive extraction are covered by Task 4.
  - admin management APIs are covered by Task 5.
  - portal resource visibility is covered by Task 6.
  - portal UI selection and runtime compatibility are covered by Tasks 7 and 8.
- Placeholder scan:
  - No `TODO`, `TBD`, or “implement later” markers remain in task steps.
- Type consistency:
  - The plan consistently uses `Workspace`, `KnowledgeSet`, `KnowledgeSetItem`, `WorkspaceKnowledgeSet`, and `ResourcePolicy` naming.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-27-agent-studio-workspace-knowledge-sets.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
