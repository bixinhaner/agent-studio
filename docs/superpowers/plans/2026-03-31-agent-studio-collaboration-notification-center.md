# Agent Studio Collaboration and Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-version collaboration and notification center capabilities for thread sharing, comments, assignment/followers, inbox consumption, broadcasts, and knowledge-capture markers.

**Architecture:** Extend the existing thread-centered platform with dedicated collaboration persistence and services instead of overloading thread ownership or generic resource policies. Reuse current DingTalk notification delivery, monitoring alert pipelines, RBAC, and thread portal UI, then add a unified inbox and lightweight broadcast management surfaces.

**Tech Stack:** Prisma, Express, TypeScript, React, assistant-ui patterns, Vitest, existing RBAC/admin audit/notification services.

---

## File Structure

### Backend
- Create: `agent-api/prisma/migrations/20260331100000_add_collaboration_center/migration.sql`
  - collaboration schema tables and indexes
- Modify: `agent-api/prisma/schema.prisma`
  - add Prisma models for collaboration/inbox/broadcast entities
- Create: `agent-api/src/persistence/thread-share-repository.ts`
  - thread sharing persistence and effective access queries
- Create: `agent-api/src/persistence/thread-share-repository.test.ts`
  - repository tests for user/department shares and revocation
- Create: `agent-api/src/persistence/thread-comment-repository.ts`
  - flat comment persistence with mention metadata
- Create: `agent-api/src/persistence/thread-comment-repository.test.ts`
  - repository tests for comment ordering and mentions
- Create: `agent-api/src/persistence/thread-collaboration-repository.ts`
  - assignment, followers, and capture-mark persistence
- Create: `agent-api/src/persistence/thread-collaboration-repository.test.ts`
  - repository tests for owner/follower/capture semantics
- Create: `agent-api/src/persistence/inbox-item-repository.ts`
  - unified inbox persistence and status transitions
- Create: `agent-api/src/persistence/inbox-item-repository.test.ts`
  - repository tests for read/unread/archive transitions
- Create: `agent-api/src/persistence/broadcast-repository.ts`
  - broadcast draft/publish persistence and target resolution records
- Create: `agent-api/src/persistence/broadcast-repository.test.ts`
  - repository tests for broadcast lifecycle
- Create: `agent-api/src/collaboration/thread-collaboration-service.ts`
  - effective access, share update, comment, assignment, capture orchestration
- Create: `agent-api/src/collaboration/thread-collaboration-service.test.ts`
  - service tests for permission and event fanout behavior
- Create: `agent-api/src/collaboration/inbox-projection-service.ts`
  - collaboration and alert-to-inbox projection
- Create: `agent-api/src/collaboration/inbox-projection-service.test.ts`
  - inbox projection tests for collaboration/alerts/broadcasts
- Create: `agent-api/src/collaboration/broadcast-service.ts`
  - broadcast creation, publish, target resolution, notification fanout
- Create: `agent-api/src/collaboration/broadcast-service.test.ts`
  - broadcast publish tests with inbox + notification behavior
- Create: `agent-api/src/collaboration/router.ts`
  - thread collaboration endpoints and inbox endpoints
- Create: `agent-api/src/collaboration/router.test.ts`
  - HTTP tests for collaboration and inbox APIs
- Create: `agent-api/src/admin/broadcast-router.ts`
  - admin broadcast management endpoints
- Create: `agent-api/src/admin/broadcast-router.test.ts`
  - admin broadcast HTTP tests
- Modify: `agent-api/src/index.ts`
  - wire repositories, services, routers, notification integration
- Modify: `agent-api/src/admin/router.ts`
  - mount admin broadcast routes
- Modify: `agent-api/src/rbac/seed-system-rbac.ts`
  - add collaboration/inbox/broadcast permission keys
- Modify: `agent-api/src/operations/notification-dispatch-service.ts`
  - optionally link notification dispatches to inbox/broadcast entities when useful
- Modify: `agent-api/src/operations/alert-evaluation-service.ts`
  - project eligible alerts into inbox via projection service
- Modify: `agent-api/src/persistence/thread-repository.ts`
  - support collaboration-safe thread reads for shared viewers if needed
- Modify: `agent-api/src/admin/router.test.ts`
  - update admin overview/route assertions if navigation changes

### Frontend
- Create: `agent-ui/src/features/collaboration/api.ts`
  - thread collaboration, inbox, and broadcast client calls
- Create: `agent-ui/src/features/collaboration/types.ts`
  - collaboration/inbox/broadcast DTOs
- Create: `agent-ui/src/features/collaboration/ThreadCollaborationPanel.tsx`
  - thread-side panel for shares, comments, assignment, capture mark
- Create: `agent-ui/src/features/collaboration/ThreadCollaborationPanel.test.tsx`
  - panel tests for share/comment/assignment flows
- Create: `agent-ui/src/features/collaboration/InboxShell.tsx`
  - user-facing inbox tabs and status actions
- Create: `agent-ui/src/features/collaboration/InboxShell.test.tsx`
  - inbox rendering and action tests
- Create: `agent-ui/src/features/collaboration/BroadcastAdminView.tsx`
  - admin broadcast draft/publish UI
- Create: `agent-ui/src/features/collaboration/BroadcastAdminView.test.tsx`
  - broadcast admin tests
- Modify: `agent-ui/src/features/portal/PortalShell.tsx`
  - add collaboration panel trigger, shared-thread readonly handling, comments visibility
- Modify: `agent-ui/src/features/portal/PortalShell.integration.test.tsx`
  - verify shared-thread readonly + collaboration payload usage
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
  - add broadcast admin entry if kept in admin shell
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
  - mount broadcast admin view in shell
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
  - verify nav and view wiring
- Modify: `agent-ui/src/styles.css`
  - collaboration panel, inbox, and broadcast styles

### Docs
- Modify: `docs/superpowers/specs/2026-03-31-agent-studio-collaboration-notification-center-design.md`
  - only if review-driven clarifications are needed during implementation

---

### Task 1: Add Collaboration Persistence Schema

**Files:**
- Create: `agent-api/prisma/migrations/20260331100000_add_collaboration_center/migration.sql`
- Modify: `agent-api/prisma/schema.prisma`
- Test: `agent-api/prisma/schema.prisma` validation via Prisma generate/diff

- [ ] **Step 1: Write the failing schema diff check**

Use a throwaway diff command that will fail until the new models exist:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg "thread_shares|thread_comments|inbox_items|broadcast_messages|knowledge_capture_marks"
```

Expected: command exits non-zero or missing expected table names before schema changes.

- [ ] **Step 2: Add Prisma models for collaboration, inbox, and broadcast entities**

Update `agent-api/prisma/schema.prisma` with models equivalent to:

```prisma
model ThreadShare {
  id             String   @id @default(cuid())
  threadId       String
  subjectType    String
  subjectId      String
  permissionLevel String
  sharedByUserId String
  createdAt      DateTime @default(now())
  revokedAt      DateTime?
  revokedByUserId String?

  @@index([threadId])
  @@index([subjectType, subjectId, revokedAt])
}

model ThreadComment {
  id               String   @id @default(cuid())
  threadId         String
  authorUserId     String
  bodyMarkdown     String
  mentionedUserIds Json?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([threadId, createdAt])
}

model ThreadAssignment {
  threadId         String   @id
  ownerUserId      String
  assignedByUserId String
  assignedAt       DateTime @default(now())
}

model ThreadFollower {
  id            String   @id @default(cuid())
  threadId      String
  userId        String
  addedByUserId String
  createdAt     DateTime @default(now())

  @@unique([threadId, userId])
  @@index([threadId])
}

model InboxItem {
  id                String   @id @default(cuid())
  userId            String
  eventType         String
  category          String
  title             String
  body              String
  status            String
  threadId          String?
  relatedEntityType String?
  relatedEntityId   String?
  sourceActorUserId String?
  payload           Json?
  createdAt         DateTime @default(now())
  readAt            DateTime?
  archivedAt        DateTime?

  @@index([userId, status, createdAt])
}

model BroadcastMessage {
  id                String   @id @default(cuid())
  title             String
  bodyMarkdown      String
  status            String
  createdByUserId   String
  publishedAt       DateTime?
  publishedByUserId String?
  dingTalkEnabled   Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model BroadcastTarget {
  id         String @id @default(cuid())
  broadcastId String
  targetType String
  targetId   String?

  @@index([broadcastId])
}

model KnowledgeCaptureMark {
  threadId        String   @id
  status          String
  markedByUserId  String
  markedAt        DateTime @default(now())
  note            String?
}
```

- [ ] **Step 3: Add migration SQL matching the new schema**

Create `agent-api/prisma/migrations/20260331100000_add_collaboration_center/migration.sql` with `CREATE TABLE`, indexes, and uniqueness constraints matching the models above. Reuse string columns and JSON columns consistent with prior migrations in this repo.

- [ ] **Step 4: Run Prisma validation and diff checks**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm run prisma:generate
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | rg "thread_shares|thread_comments|inbox_items|broadcast_messages|knowledge_capture_marks"
```

Expected: `prisma generate` succeeds and the diff output includes all collaboration tables.

- [ ] **Step 5: Commit**

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
git add agent-api/prisma/schema.prisma agent-api/prisma/migrations
git commit -m "feat: add collaboration center schema"
```

### Task 2: Add Collaboration and Inbox Repositories

**Files:**
- Create: `agent-api/src/persistence/thread-share-repository.ts`
- Create: `agent-api/src/persistence/thread-share-repository.test.ts`
- Create: `agent-api/src/persistence/thread-comment-repository.ts`
- Create: `agent-api/src/persistence/thread-comment-repository.test.ts`
- Create: `agent-api/src/persistence/thread-collaboration-repository.ts`
- Create: `agent-api/src/persistence/thread-collaboration-repository.test.ts`
- Create: `agent-api/src/persistence/inbox-item-repository.ts`
- Create: `agent-api/src/persistence/inbox-item-repository.test.ts`
- Create: `agent-api/src/persistence/broadcast-repository.ts`
- Create: `agent-api/src/persistence/broadcast-repository.test.ts`

- [ ] **Step 1: Write failing repository tests for share/comment/assignment/inbox/broadcast behavior**

Add tests that cover at least these cases:

```ts
it("lists effective direct and department shares for a user", async () => {
  const repo = new ThreadShareRepository(db);
  await repo.replaceForThread("thread-1", [
    { subjectType: "user", subjectId: "user-1", permissionLevel: "read_comment", sharedByUserId: "owner-1" },
    { subjectType: "department", subjectId: "dept-1", permissionLevel: "read_comment", sharedByUserId: "owner-1" }
  ]);

  const effective = await repo.listEffectiveForUser({ threadId: "thread-1", userId: "user-1", departmentIds: ["dept-1"] });
  expect(effective).toHaveLength(2);
});

it("stores flat comments in created order with mentioned users", async () => {
  const repo = new ThreadCommentRepository(db);
  await repo.create({ threadId: "thread-1", authorUserId: "user-1", bodyMarkdown: "hello @u2", mentionedUserIds: ["user-2"] });
  const comments = await repo.listForThread("thread-1");
  expect(comments[0]?.mentionedUserIds).toEqual(["user-2"]);
});

it("updates inbox item read/archive states", async () => {
  const repo = new InboxItemRepository(db);
  const item = await repo.create({ userId: "user-1", eventType: "thread.shared", category: "collaboration", title: "shared", body: "body" });
  await repo.markRead(item.id, "user-1");
  await repo.archive(item.id, "user-1");
  const stored = await repo.getOwned(item.id, "user-1");
  expect(stored?.status).toBe("archived");
});
```

- [ ] **Step 2: Run repository tests to confirm failure**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/persistence/thread-share-repository.test.ts src/persistence/thread-comment-repository.test.ts src/persistence/thread-collaboration-repository.test.ts src/persistence/inbox-item-repository.test.ts src/persistence/broadcast-repository.test.ts
```

Expected: FAIL because repository files do not exist yet.

- [ ] **Step 3: Implement minimal repositories to satisfy the tests**

Implement focused repository APIs:

```ts
export class ThreadShareRepository {
  async replaceForThread(threadId: string, shares: ThreadShareInput[]): Promise<ThreadShareRecord[]> {}
  async listForThread(threadId: string): Promise<ThreadShareRecord[]> {}
  async listEffectiveForUser(input: { threadId: string; userId: string; departmentIds: string[] }): Promise<ThreadShareRecord[]> {}
}

export class ThreadCommentRepository {
  async create(input: ThreadCommentInput): Promise<ThreadCommentRecord> {}
  async listForThread(threadId: string): Promise<ThreadCommentRecord[]> {}
}

export class ThreadCollaborationRepository {
  async setAssignment(input: ThreadAssignmentInput): Promise<ThreadAssignmentRecord> {}
  async replaceFollowers(threadId: string, followerIds: string[], addedByUserId: string): Promise<ThreadFollowerRecord[]> {}
  async setCaptureMark(input: ThreadCaptureMarkInput | null): Promise<ThreadCaptureMarkRecord | null> {}
  async getState(threadId: string): Promise<{ assignment: ThreadAssignmentRecord | null; followers: ThreadFollowerRecord[]; captureMark: ThreadCaptureMarkRecord | null }> {}
}
```

For inbox and broadcast repositories, expose only create/list/update methods required by the tests and later services.

- [ ] **Step 4: Run repository tests and full backend build**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/persistence/thread-share-repository.test.ts src/persistence/thread-comment-repository.test.ts src/persistence/thread-collaboration-repository.test.ts src/persistence/inbox-item-repository.test.ts src/persistence/broadcast-repository.test.ts
npm run build
```

Expected: all repository tests pass and TypeScript build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
git add agent-api/src/persistence agent-api/prisma
git commit -m "feat: add collaboration repositories"
```

### Task 3: Add Collaboration Services and Inbox Projection

**Files:**
- Create: `agent-api/src/collaboration/thread-collaboration-service.ts`
- Create: `agent-api/src/collaboration/thread-collaboration-service.test.ts`
- Create: `agent-api/src/collaboration/inbox-projection-service.ts`
- Create: `agent-api/src/collaboration/inbox-projection-service.test.ts`
- Create: `agent-api/src/collaboration/broadcast-service.ts`
- Create: `agent-api/src/collaboration/broadcast-service.test.ts`
- Modify: `agent-api/src/operations/alert-evaluation-service.ts`
- Modify: `agent-api/src/operations/notification-dispatch-service.ts`
- Modify: `agent-api/src/rbac/seed-system-rbac.ts`

- [ ] **Step 1: Write failing service tests for collaboration access and event fanout**

Add tests for at least:

```ts
it("allows shared users to comment but not continue runtime ownership", async () => {
  const service = createThreadCollaborationService();
  await service.replaceShares({ actorUserId: "owner-1", threadId: "thread-1", shares: [{ subjectType: "user", subjectId: "user-2" }] });
  const summary = await service.getThreadCollaborationView({ actorUserId: "user-2", departmentIds: [], threadId: "thread-1" });
  expect(summary.access.canComment).toBe(true);
  expect(summary.access.canRun).toBe(false);
});

it("creates inbox items for mentions and assignment changes", async () => {
  const service = createThreadCollaborationService();
  await service.addComment({ actorUserId: "user-1", threadId: "thread-1", bodyMarkdown: "ping @user-2", mentionedUserIds: ["user-2"] });
  await service.setAssignment({ actorUserId: "user-1", threadId: "thread-1", ownerUserId: "user-3", followerIds: ["user-2"] });
  const inbox = await inboxRepo.listForUser("user-2");
  expect(inbox.map((item) => item.eventType)).toContain("thread.mentioned");
});

it("publishes broadcasts into inbox items for resolved users", async () => {
  const service = createBroadcastService();
  const draft = await service.createDraft({ actorUserId: "admin-1", title: "Heads up", bodyMarkdown: "Message", targets: [{ targetType: "department", targetId: "dept-1" }] });
  await service.publish({ actorUserId: "admin-1", broadcastId: draft.id });
  expect((await inboxRepo.listForUser("dept-user-1")).some((item) => item.category === "broadcast")).toBe(true);
});
```

- [ ] **Step 2: Run service tests to confirm failure**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/collaboration/thread-collaboration-service.test.ts src/collaboration/inbox-projection-service.test.ts src/collaboration/broadcast-service.test.ts
```

Expected: FAIL because services do not exist yet.

- [ ] **Step 3: Implement minimal services and permission seeding**

Implement:

```ts
export class ThreadCollaborationService {
  async getThreadCollaborationView(input: { actorUserId: string; departmentIds: string[]; threadId: string }): Promise<ThreadCollaborationView> {}
  async replaceShares(input: { actorUserId: string; threadId: string; shares: ShareInput[] }): Promise<ThreadShareRecord[]> {}
  async addComment(input: { actorUserId: string; threadId: string; bodyMarkdown: string; mentionedUserIds: string[] }): Promise<ThreadCommentRecord> {}
  async setAssignment(input: { actorUserId: string; threadId: string; ownerUserId: string; followerIds: string[] }): Promise<ThreadCollaborationState> {}
  async setCaptureMark(input: { actorUserId: string; threadId: string; note?: string | null; enabled: boolean }): Promise<ThreadCaptureMarkRecord | null> {}
}

export class InboxProjectionService {
  async projectCollaborationEvent(input: InboxProjectionInput): Promise<void> {}
  async projectAlertEvent(input: AlertInboxProjectionInput): Promise<void> {}
}

export class BroadcastService {
  async createDraft(input: BroadcastDraftInput): Promise<BroadcastRecord> {}
  async updateDraft(input: BroadcastUpdateInput): Promise<BroadcastRecord> {}
  async publish(input: { actorUserId: string; broadcastId: string }): Promise<BroadcastRecord> {}
}
```

Add new permission keys to `seed-system-rbac.ts`:

```ts
{ key: "collaboration.read", name: "Read collaboration views", category: "collaboration" },
{ key: "collaboration.share", name: "Manage thread sharing", category: "collaboration" },
{ key: "collaboration.comment", name: "Comment on shared threads", category: "collaboration" },
{ key: "collaboration.assign", name: "Assign collaboration owners", category: "collaboration" },
{ key: "collaboration.broadcast.publish", name: "Publish broadcasts", category: "collaboration" },
{ key: "collaboration.capture_mark.write", name: "Mark knowledge capture candidates", category: "collaboration" },
{ key: "inbox.read", name: "Read inbox items", category: "collaboration" },
{ key: "inbox.write", name: "Update inbox items", category: "collaboration" }
```

- [ ] **Step 4: Run service tests and selected integration tests**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/collaboration/thread-collaboration-service.test.ts src/collaboration/inbox-projection-service.test.ts src/collaboration/broadcast-service.test.ts src/operations/notification-dispatch-service.test.ts
npm run build
```

Expected: service tests pass and build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
git add agent-api/src/collaboration agent-api/src/operations agent-api/src/rbac
git commit -m "feat: add collaboration services"
```

### Task 4: Add Collaboration and Inbox HTTP APIs

**Files:**
- Create: `agent-api/src/collaboration/router.ts`
- Create: `agent-api/src/collaboration/router.test.ts`
- Create: `agent-api/src/admin/broadcast-router.ts`
- Create: `agent-api/src/admin/broadcast-router.test.ts`
- Modify: `agent-api/src/index.ts`
- Modify: `agent-api/src/admin/router.ts`
- Modify: `agent-api/src/admin/router.test.ts`
- Modify: `agent-api/src/persistence/thread-repository.ts` (only if collaboration-safe shared reads require a helper)

- [ ] **Step 1: Write failing HTTP tests for collaboration, inbox, and broadcasts**

Add tests that cover at least:

```ts
it("returns collaboration state for a shared thread viewer", async () => {
  const app = createTestApp();
  const response = await request(app).get("/api/threads/thread-1/collaboration").set("x-test-user", "user-2");
  expect(response.status).toBe(200);
  expect(response.body.access.canComment).toBe(true);
});

it("updates inbox read/archive status for the current user", async () => {
  const app = createTestApp();
  const read = await request(app).post("/api/inbox/inbox-1/read").set("x-test-user", "user-1");
  expect(read.status).toBe(200);
});

it("publishes a broadcast through the admin API", async () => {
  const app = createTestApp();
  const response = await request(app).post("/api/admin/broadcasts/broadcast-1/publish").set("x-test-user", "admin-1");
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run HTTP tests to confirm failure**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/collaboration/router.test.ts src/admin/broadcast-router.test.ts src/admin/router.test.ts
```

Expected: FAIL because routes are not mounted yet.

- [ ] **Step 3: Implement minimal routers and wire them into the app**

Add collaboration router endpoints:

```ts
router.get("/api/threads/:threadId/collaboration", ...);
router.put("/api/threads/:threadId/shares", ...);
router.get("/api/threads/:threadId/comments", ...);
router.post("/api/threads/:threadId/comments", ...);
router.put("/api/threads/:threadId/assignment", ...);
router.put("/api/threads/:threadId/followers", ...);
router.put("/api/threads/:threadId/capture-mark", ...);
router.get("/api/inbox", ...);
router.post("/api/inbox/:itemId/read", ...);
router.post("/api/inbox/:itemId/unread", ...);
router.post("/api/inbox/:itemId/archive", ...);
router.post("/api/inbox/:itemId/unarchive", ...);
```

Add admin broadcast router endpoints:

```ts
router.get("/broadcasts", ...);
router.post("/broadcasts", ...);
router.patch("/broadcasts/:broadcastId", ...);
router.post("/broadcasts/:broadcastId/publish", ...);
```

Mount in:
- `agent-api/src/index.ts` for user endpoints
- `agent-api/src/admin/router.ts` under `/api/admin`

- [ ] **Step 4: Run HTTP tests, selected collaboration tests, and backend build**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/collaboration/router.test.ts src/admin/broadcast-router.test.ts src/admin/router.test.ts src/collaboration/thread-collaboration-service.test.ts
npm run build
```

Expected: HTTP tests and build pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
git add agent-api/src/collaboration agent-api/src/admin agent-api/src/index.ts agent-api/src/persistence/thread-repository.ts
git commit -m "feat: add collaboration center api"
```

### Task 5: Add Portal Collaboration Panel and Shared-Thread Readonly UI

**Files:**
- Create: `agent-ui/src/features/collaboration/api.ts`
- Create: `agent-ui/src/features/collaboration/types.ts`
- Create: `agent-ui/src/features/collaboration/ThreadCollaborationPanel.tsx`
- Create: `agent-ui/src/features/collaboration/ThreadCollaborationPanel.test.tsx`
- Modify: `agent-ui/src/features/portal/PortalShell.tsx`
- Modify: `agent-ui/src/features/portal/PortalShell.integration.test.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing UI tests for collaboration panel and shared-thread readonly mode**

Add tests that cover at least:

```tsx
it("renders comments, shares, assignment, and capture controls for an owned thread", async () => {
  render(<ThreadCollaborationPanel threadId="thread-1" canManageShares canComment />);
  expect(await screen.findByText("分享对象")).toBeInTheDocument();
  expect(screen.getByText("待沉淀标记")).toBeInTheDocument();
});

it("disables runtime composer when the active thread is shared-readonly", async () => {
  render(<PortalShell />);
  expect(await screen.findByText("此共享会话为只读，不能继续发起新运行")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests to confirm failure**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/collaboration/ThreadCollaborationPanel.test.tsx src/features/portal/PortalShell.integration.test.tsx
```

Expected: FAIL because collaboration UI files do not exist and PortalShell does not expose readonly shared-thread state yet.

- [ ] **Step 3: Implement minimal collaboration panel and portal wiring**

Implement API helpers:

```ts
export async function fetchThreadCollaboration(threadId: string): Promise<ThreadCollaborationView> {}
export async function updateThreadShares(threadId: string, body: UpdateThreadSharesRequest): Promise<ThreadCollaborationView> {}
export async function createThreadComment(threadId: string, body: CreateThreadCommentRequest): Promise<ThreadComment> {}
export async function updateThreadAssignment(threadId: string, body: UpdateThreadAssignmentRequest): Promise<ThreadCollaborationView> {}
export async function updateThreadCaptureMark(threadId: string, body: UpdateThreadCaptureMarkRequest): Promise<ThreadCollaborationView> {}
```

Update `PortalShell.tsx` to:
- fetch collaboration view for the active thread
- render a collaboration side panel/button
- suppress composer submit affordance when `access.canRun === false`
- still render thread messages and attachment list for shared viewers

- [ ] **Step 4: Run collaboration UI tests and frontend build**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/collaboration/ThreadCollaborationPanel.test.tsx src/features/portal/PortalShell.integration.test.tsx
npm run build
```

Expected: collaboration tests pass and frontend build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
git add agent-ui/src/features/collaboration agent-ui/src/features/portal/PortalShell.tsx agent-ui/src/features/portal/PortalShell.integration.test.tsx agent-ui/src/styles.css
git commit -m "feat: add thread collaboration panel"
```

### Task 6: Add Inbox UI and Admin Broadcast Management UI

**Files:**
- Create: `agent-ui/src/features/collaboration/InboxShell.tsx`
- Create: `agent-ui/src/features/collaboration/InboxShell.test.tsx`
- Create: `agent-ui/src/features/collaboration/BroadcastAdminView.tsx`
- Create: `agent-ui/src/features/collaboration/BroadcastAdminView.test.tsx`
- Modify: `agent-ui/src/features/admin/AdminNav.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.test.tsx`
- Modify: `agent-ui/src/styles.css`

- [ ] **Step 1: Write failing UI tests for inbox and admin broadcast views**

Add tests that cover at least:

```tsx
it("renders inbox tabs and allows read/archive actions", async () => {
  render(<InboxShell />);
  expect(await screen.findByRole("tab", { name: "协作" })).toBeInTheDocument();
});

it("renders broadcast draft form and publish action in admin shell", async () => {
  render(<AdminShell />);
  expect(await screen.findByText("广播管理")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests to confirm failure**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/collaboration/InboxShell.test.tsx src/features/collaboration/BroadcastAdminView.test.tsx src/features/admin/AdminShell.test.tsx
```

Expected: FAIL because inbox and broadcast views do not exist yet.

- [ ] **Step 3: Implement inbox shell and admin broadcast view**

Implement inbox API helpers and UI that:
- fetches `GET /api/inbox`
- filters by `全部 / 协作 / 告警 / 广播`
- supports `read / unread / archive / unarchive`
- navigates to related thread when present

Implement `BroadcastAdminView.tsx` that:
- lists draft/published broadcasts
- edits title/body/targets/dingtalk toggle
- publishes through `/api/admin/broadcasts/:broadcastId/publish`

Mount the admin broadcast view through `AdminNav.tsx` and `AdminShell.tsx` using the same shell conventions as other admin centers.

- [ ] **Step 4: Run targeted frontend tests and full frontend suite**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/collaboration/InboxShell.test.tsx src/features/collaboration/BroadcastAdminView.test.tsx src/features/admin/AdminShell.test.tsx
npm test
npm run build
```

Expected: targeted tests, full frontend tests, and build all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
git add agent-ui/src/features/collaboration agent-ui/src/features/admin agent-ui/src/styles.css
git commit -m "feat: add inbox and broadcast admin views"
```

### Task 7: Run End-to-End Verification and Close Gaps

**Files:**
- Modify: any files touched above only if verification exposes gaps
- Test: backend + frontend full suites

- [ ] **Step 1: Run focused backend collaboration verification**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test -- src/persistence/thread-share-repository.test.ts src/persistence/thread-comment-repository.test.ts src/persistence/thread-collaboration-repository.test.ts src/persistence/inbox-item-repository.test.ts src/persistence/broadcast-repository.test.ts src/collaboration/thread-collaboration-service.test.ts src/collaboration/inbox-projection-service.test.ts src/collaboration/broadcast-service.test.ts src/collaboration/router.test.ts src/admin/broadcast-router.test.ts
```

Expected: all collaboration/backend tests pass.

- [ ] **Step 2: Run focused frontend collaboration verification**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test -- src/features/collaboration/ThreadCollaborationPanel.test.tsx src/features/collaboration/InboxShell.test.tsx src/features/collaboration/BroadcastAdminView.test.tsx src/features/portal/PortalShell.integration.test.tsx src/features/admin/AdminShell.test.tsx
```

Expected: all collaboration/frontend tests pass.

- [ ] **Step 3: Run full project verification**

Run:

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api
npm test && npm run build && npm run prisma:generate
cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui
npm test && npm run build
```

Expected: full backend/frontend test suites pass; builds succeed; Prisma client generation succeeds.

- [ ] **Step 4: Fix only verification-exposed issues**

If any failures appear, fix the smallest responsible code paths in the files already introduced by Tasks 1-6. Re-run the exact failing command before moving on.

- [ ] **Step 5: Commit final verification fixes**

```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
git add agent-api agent-ui
git commit -m "fix: finalize collaboration center verification"
```

## Self-Review

### Spec coverage
- Thread sharing: Task 1 schema, Task 2 repositories, Task 3 service, Task 4 API, Task 5 UI.
- Comments with `@user`: Task 1 schema, Task 2 repository, Task 3 service, Task 4 API, Task 5 UI.
- Single owner + followers: Task 1 schema, Task 2 repository, Task 3 service, Task 4 API, Task 5 UI.
- Unified inbox for collaboration/alerts/broadcasts: Task 1 schema, Task 2 repository, Task 3 projection service, Task 4 API, Task 6 UI.
- DingTalk delivery: Task 3 service integration.
- Broadcast creation/publish: Task 1 schema, Task 2 repository, Task 3 service, Task 4 admin API, Task 6 admin UI.
- Knowledge capture mark: Task 1 schema, Task 2 repository, Task 3 service, Task 4 API, Task 5 UI.
- Shared thread readonly access: Task 3 service semantics, Task 4 API, Task 5 portal UI.
- Attachment permission preservation: Task 3 service semantics and Task 5 UI expectations.

### Placeholder scan
- No `TODO`, `TBD`, “similar to Task N”, or unspecified code steps remain.
- Each task includes explicit files, tests, commands, and commit boundaries.

### Type consistency
- Thread collaboration service names, inbox item statuses, broadcast statuses, and permission keys are used consistently across tasks.
- Shared-thread access is consistently represented as `read_comment` plus `access.canRun === false` for non-owners.
