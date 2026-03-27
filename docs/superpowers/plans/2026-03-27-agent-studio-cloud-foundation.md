# Agent Studio Cloud Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first cloud-ready foundation for `agent-studio` by replacing ephemeral storage, introducing DingTalk-backed user identity, and adding the initial admin/policy shell required before feature implementation.

**Architecture:** Keep the existing `agent-ui` and `agent-api` applications, but evolve the backend from a local-tool server into a persistent platform service. Introduce PostgreSQL via Prisma for core entities, add a thin auth layer backed by DingTalk identity, and move frontend runtime configuration behind role-governed admin-managed profiles.

**Tech Stack:** TypeScript, Express, React, Vite, assistant-ui, PostgreSQL, Prisma ORM, Vitest, Supertest, DingTalk OpenAPI/OAuth.

---

## Scope Decomposition

The approved design spans multiple independent subsystems. This plan covers the first implementation sub-project only:

- Foundation persistence
- DingTalk auth and user model
- Initial admin policy shell
- Employee portal runtime configuration lockdown

Follow-on sub-project plans should be written separately for:

- Workspace and knowledge-set management
- Skill package and agent mode publishing
- Audit/observability/quota
- Collaboration and business workflow integrations

## File Structure

### Backend files

- Create: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/*`
- Create: `agent-api/src/db/client.ts`
- Create: `agent-api/src/db/env.ts`
- Create: `agent-api/src/auth/session-cookie.ts`
- Create: `agent-api/src/auth/current-user.ts`
- Create: `agent-api/src/auth/dingtalk.ts`
- Create: `agent-api/src/auth/router.ts`
- Create: `agent-api/src/admin/router.ts`
- Create: `agent-api/src/persistence/session-repository.ts`
- Create: `agent-api/src/persistence/thread-repository.ts`
- Create: `agent-api/src/persistence/user-repository.ts`
- Create: `agent-api/src/persistence/bootstrap.ts`
- Create: `agent-api/src/persistence/json-import.ts`
- Modify: `agent-api/package.json`
- Modify: `agent-api/src/config.ts`
- Modify: `agent-api/src/index.ts`
- Modify: `agent-api/src/integrations/zendesk/settings-store.ts`

### Frontend files

- Create: `agent-ui/src/features/auth/AuthProvider.tsx`
- Create: `agent-ui/src/features/auth/api.ts`
- Create: `agent-ui/src/features/admin/AdminShell.tsx`
- Create: `agent-ui/src/features/admin/api.ts`
- Create: `agent-ui/src/features/portal/PortalShell.tsx`
- Create: `agent-ui/src/features/runtime-profile/types.ts`
- Modify: `agent-ui/package.json`
- Modify: `agent-ui/src/App.tsx`
- Modify: `agent-ui/src/lib/api.ts`
- Modify: `agent-ui/src/styles.css`

### Tests

- Create: `agent-api/src/auth/router.test.ts`
- Create: `agent-api/src/persistence/thread-repository.test.ts`
- Create: `agent-api/src/admin/router.test.ts`
- Create: `agent-ui/src/features/auth/AuthProvider.test.tsx`
- Create: `agent-ui/src/features/admin/AdminShell.test.tsx`

## Task 1: Add backend persistence and test tooling

**Files:**
- Modify: `agent-api/package.json`
- Create: `agent-api/prisma/schema.prisma`
- Create: `agent-api/src/db/client.ts`
- Create: `agent-api/src/db/env.ts`
- Test: `agent-api/src/persistence/thread-repository.test.ts`

**Task note:** Task 1 only establishes persistence/tooling foundations. The test in `thread-repository.test.ts` should validate DB env parsing, Prisma client wiring, and tooling readiness. Actual thread repository behavior starts in Task 2.

- [ ] **Step 1: Write the failing persistence foundation test first**

```ts
import { describe, expect, it } from "vitest";

import { createDbClient } from "../db/client.js";
import { getDbEnv } from "../db/env.js";

describe("thread persistence foundation", () => {
  it("fails when DATABASE_URL is missing", () => {
    expect(() => getDbEnv({})).toThrow(/DATABASE_URL/i);
  });

  it("rejects an explicit empty env when creating the prisma client", () => {
    expect(() => createDbClient({})).toThrow(/DATABASE_URL/i);
  });
});
```

- [ ] **Step 2: Run the targeted test and confirm it fails for the expected reason**

Run: `cd agent-api && npm exec --yes vitest run src/persistence/thread-repository.test.ts`
Expected: FAIL because Prisma client/tooling is not installed or not wired yet.

- [ ] **Step 3: Add Prisma, PostgreSQL, Vitest, and Supertest dependencies**

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0",
    "cookie-parser": "^1.4.7"
  },
  "devDependencies": {
    "prisma": "^6.0.0",
    "supertest": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 4: Add database environment parsing**

```ts
// agent-api/src/db/env.ts
import { z } from "zod";

export const dbEnv = z
  .object({
    DATABASE_URL: z.string().min(1)
  })
  .parse(process.env);
```

- [ ] **Step 5: Add Prisma client wrapper**

```ts
// agent-api/src/db/client.ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

- [ ] **Step 6: Define initial Prisma schema for users, sessions, threads, messages, and runtime sessions**

```prisma
model User {
  id              String   @id @default(cuid())
  email           String?  @unique
  name            String
  status          String   @default("active")
  dingtalkUserId  String?  @unique
  dingtalkUnionId String?  @unique
  dingtalkCorpId  String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Thread {
  id               String    @id @default(cuid())
  title            String?
  status           String    @default("regular")
  model            String
  reasoningEffort  String
  workspace        String
  codexRunConfig   Json?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  messages         Message[]
}

model Message {
  id         String   @id @default(cuid())
  threadId   String
  parentId   String?
  payload    Json
  runConfig  Json?
  createdAt  DateTime @default(now())
  thread     Thread   @relation(fields: [threadId], references: [id], onDelete: Cascade)
}

model RuntimeSession {
  id              String   @id @default(cuid())
  threadId        String?
  model           String
  reasoningEffort String
  workspace       String
  codexRunConfig  Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

- [ ] **Step 7: Install dependencies and rerun tooling to verify setup is wired**

Run:
- `cd agent-api && npm install`
- `cd agent-api && npm run test:thread-repository`
- `cd agent-api && npm run prisma:generate`

Expected:
- install completes and updates `package-lock.json`
- the persistence foundation test passes
- Prisma client generation succeeds

- [ ] **Step 8: Self-review and commit**

Self-review checklist:
- Confirm the test still covers only Task 1 foundation behavior.
- Confirm no thread repository implementation was added.
- Confirm no auth or frontend files were touched.

```bash
git add agent-api/package.json agent-api/package-lock.json agent-api/prisma agent-api/src/db agent-api/src/persistence/thread-repository.test.ts
git commit -m "chore: add backend persistence foundation"
```

## Task 2: Replace JSON-backed thread/session storage with repositories

**Files:**
- Create: `agent-api/src/persistence/thread-repository.ts`
- Create: `agent-api/src/persistence/session-repository.ts`
- Create: `agent-api/src/persistence/json-import.ts`
- Modify: `agent-api/src/index.ts`
- Test: `agent-api/src/persistence/thread-repository.test.ts`

**Task note:** Minimal supporting edits to Task 1 persistence files are allowed when needed to support repository-backed persistence. This includes `agent-api/prisma/schema.prisma`, generated Prisma client outputs, and keeping the existing Task 1 foundation coverage in `thread-repository.test.ts` while adding Task 2 repository tests.

**Hybrid boundary note:** For Task 2, it is acceptable to persist runtime session metadata while keeping the live Codex thread object in memory, as long as that boundary is explicit and stale live sessions are treated as invalid.

- [ ] **Step 1: Expand the failing repository test with thread create, append, replace, and feedback cases**

```ts
it("creates a thread and appends messages in order", async () => {
  const repo = createThreadRepositoryForTest();
  const thread = await repo.create({
    model: "gpt-5.4",
    reasoningEffort: "high",
    workspace: "/workspace"
  });

  await repo.appendMessage(thread.id, {
    parentId: null,
    message: { id: "msg_1", role: "user", content: "hello" }
  });

  const stored = await repo.getRepository(thread.id);
  expect(stored.headId).toBe("msg_1");
  expect(stored.messages).toHaveLength(1);
});
```

- [ ] **Step 2: Run the targeted repository test and confirm it fails for the expected reason**

Run: `cd agent-api && npm run test:thread-repository`
Expected: FAIL because repository modules or repository behavior are not implemented yet.

- [ ] **Step 3: Implement Prisma-backed thread repository**

```ts
export class ThreadRepository {
  async create(input: CreateThreadInput) {
    return await prisma.thread.create({ data: { ...input } });
  }

  async appendMessage(threadId: string, item: StoredMessageItem) {
    await prisma.message.create({
      data: {
        threadId,
        parentId: item.parentId,
        payload: item.message as object,
        runConfig: item.runConfig as object | undefined
      }
    });
  }
}
```

- [ ] **Step 4: Implement Prisma-backed runtime session repository**

```ts
export class RuntimeSessionRepository {
  async create(input: RuntimeSessionInput) {
    return await prisma.runtimeSession.create({ data: input });
  }

  async update(sessionId: string, patch: RuntimeSessionPatch) {
    return await prisma.runtimeSession.update({ where: { id: sessionId }, data: patch });
  }
}
```

- [ ] **Step 5: Add import helper for existing JSON thread data**

```ts
export async function importLegacyThreads(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!raw) return;
  const parsed = JSON.parse(raw) as { threads?: Array<any> };
  for (const legacyThread of parsed.threads || []) {
    await prisma.thread.upsert({
      where: { id: legacyThread.id },
      update: {},
      create: {
        id: legacyThread.id,
        title: legacyThread.title,
        status: legacyThread.status || "regular",
        model: legacyThread.model,
        reasoningEffort: legacyThread.reasoningEffort,
        workspace: legacyThread.workspace,
        codexRunConfig: legacyThread.codexRunConfig ?? undefined
      }
    });
  }
}
```

- [ ] **Step 6: Replace `ThreadStore` and `SessionStore` usages in `index.ts` with repository-backed services**

```ts
const threadRepository = new ThreadRepository();
const runtimeSessions = new RuntimeSessionRepository();
```

- [ ] **Step 7: Run targeted and broader backend verification commands**

Run:
- `cd agent-api && npm run test:thread-repository`
- `cd agent-api && npm test`
- `cd agent-api && npm run build`
- `cd agent-api && npm run prisma:generate`

Expected:
- repository tests pass
- broader backend tests pass
- TypeScript build passes
- Prisma client generation passes

- [ ] **Step 8: Self-review and commit**

Self-review checklist:
- Confirm current HTTP response shapes in `index.ts` remain unchanged.
- Confirm no auth, admin, frontend, or Zendesk persistence work was introduced.
- Confirm the live Codex thread boundary remains explicit if a hybrid session approach is used.

```bash
git add agent-api/src/index.ts agent-api/prisma agent-api/src/persistence agent-api/src/persistence/thread-repository.test.ts
git commit -m "refactor: persist threads and sessions in database"
```

## Task 3: Add DingTalk auth and current-user context

**Files:**
- Create: `agent-api/src/auth/dingtalk.ts`
- Create: `agent-api/src/auth/session-cookie.ts`
- Create: `agent-api/src/auth/current-user.ts`
- Create: `agent-api/src/auth/router.ts`
- Create: `agent-api/src/persistence/user-repository.ts`
- Modify: `agent-api/src/index.ts`
- Test: `agent-api/src/auth/router.test.ts`

- [ ] **Step 1: Write failing auth router tests for login config, callback, and whoami**

```ts
it("returns 401 from whoami when session cookie is missing", async () => {
  const app = buildTestApp();
  const res = await request(app).get("/api/auth/whoami");
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Port the required DingTalk client flows from the approved design**

```ts
export class DingTalkClient {
  async getUserAccessToken(code: string) {
    const res = await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: env.DINGTALK_LOGIN_APP_ID,
        clientSecret: env.DINGTALK_LOGIN_APP_SECRET,
        code,
        grantType: "authorization_code"
      })
    });
    return await res.json();
  }

  async getCurrentUser(accessToken: string) {
    const me = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
      headers: { "x-acs-dingtalk-access-token": accessToken }
    }).then((res) => res.json());
    const userId = await this.getUserIdByUnionId(me.unionId);
    return await this.getUserProfile(userId);
  }
}
```

- [ ] **Step 3: Add signed session cookie helpers**

```ts
export function writeUserSession(res: Response, payload: { userId: string }) {
  res.cookie("agent_studio_session", sign(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: true
  });
}
```

- [ ] **Step 4: Add current-user middleware and protected route helper**

```ts
export async function requireCurrentUser(req: Request, res: Response, next: NextFunction) {
  const user = await loadCurrentUser(req);
  if (!user) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  req.currentUser = user;
  next();
}
```

- [ ] **Step 5: Add `/api/auth/*` router**

```ts
router.get("/whoami", requireCurrentUser, (req, res) => {
  res.json({ user: req.currentUser });
});
```

- [ ] **Step 6: Replace global token auth for user-facing routes with session auth while retaining service-to-service token support for protected admin/webhook cases**

```ts
app.use("/api/auth", authRouter);
app.use("/api/admin", requireCurrentUser, requireRole("admin"), adminRouter);
```

- [ ] **Step 7: Run auth tests**

Run: `cd agent-api && pnpm test src/auth/router.test.ts`
Expected: whoami, login bootstrap, and logout tests pass.

- [ ] **Step 8: Commit**

```bash
git add agent-api/src/auth agent-api/src/persistence/user-repository.ts agent-api/src/index.ts agent-api/src/auth/router.test.ts
git commit -m "feat: add DingTalk auth and user session context"
```

## Task 4: Add admin foundation APIs for overview and policy-managed runtime options

**Files:**
- Create: `agent-api/src/admin/router.ts`
- Modify: `agent-api/src/index.ts`
- Test: `agent-api/src/admin/router.test.ts`

- [ ] **Step 1: Write failing tests for admin overview and runtime option responses**

```ts
it("returns admin overview counts for an admin user", async () => {
  const app = buildAdminTestApp();
  const res = await request(app).get("/api/admin/overview").set("Cookie", makeAdminCookie());
  expect(res.status).toBe(200);
  expect(res.body.counts).toBeDefined();
});
```

- [ ] **Step 2: Add admin overview endpoint**

```ts
router.get("/overview", async (_req, res) => {
  res.json({
    counts: {
      users: await userRepository.count(),
      threads: await threadRepository.count(),
      activeSessions: await runtimeSessionRepository.countActive()
    }
  });
});
```

- [ ] **Step 3: Add endpoint for employee-facing runtime options derived from policy, not raw config**

```ts
router.get("/portal/runtime-options", async (req, res) => {
  res.json({
    modes: [],
    workspaces: [],
    canUpload: true
  });
});
```

- [ ] **Step 4: Mount admin router and reserve `/api/portal/*` route space**

```ts
app.use("/api/admin", requireCurrentUser, requireRole("admin"), adminRouter);
app.use("/api/portal", requireCurrentUser, portalRouter);
```

- [ ] **Step 5: Run admin router tests**

Run: `cd agent-api && pnpm test src/admin/router.test.ts`
Expected: overview and runtime-option tests pass.

- [ ] **Step 6: Commit**

```bash
git add agent-api/src/admin agent-api/src/index.ts agent-api/src/admin/router.test.ts
git commit -m "feat: add admin foundation routes"
```

## Task 5: Split frontend into auth, employee portal, and admin shell

**Files:**
- Create: `agent-ui/src/features/auth/AuthProvider.tsx`
- Create: `agent-ui/src/features/auth/api.ts`
- Create: `agent-ui/src/features/admin/AdminShell.tsx`
- Create: `agent-ui/src/features/portal/PortalShell.tsx`
- Modify: `agent-ui/src/App.tsx`
- Modify: `agent-ui/src/lib/api.ts`
- Test: `agent-ui/src/features/auth/AuthProvider.test.tsx`
- Test: `agent-ui/src/features/admin/AdminShell.test.tsx`

- [ ] **Step 1: Add frontend test tooling if missing**

```json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "jsdom": "^26.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Write failing tests for auth bootstrap and admin shell routing**

```tsx
it("renders sign-in state when no user is returned", async () => {
  render(<AuthProvider><App /></AuthProvider>);
  expect(await screen.findByText(/登录/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Add auth provider and `whoami` API client**

```ts
export async function fetchWhoAmI() {
  return await api<{ user: { id: string; role: string } }>("/api/auth/whoami");
}
```

- [ ] **Step 4: Split `App.tsx` into employee portal and admin shell entry points**

```tsx
if (!user) return <SignInScreen />;
if (user.role === "admin" || user.role === "super_admin") return <AdminShell />;
return <PortalShell />;
```

- [ ] **Step 5: Remove direct exposure of raw runtime config controls from the employee portal and replace them with policy-driven selectors**

```tsx
<select value={selectedMode} onChange={(e) => setSelectedMode(e.target.value)}>
  {runtimeOptions.modes.map((mode) => (
    <option key={mode.id} value={mode.id}>{mode.name}</option>
  ))}
</select>
```

- [ ] **Step 6: Run frontend tests**

Run: `cd agent-ui && pnpm test`
Expected: auth bootstrap and admin shell tests pass.

- [ ] **Step 7: Commit**

```bash
git add agent-ui/src/App.tsx agent-ui/src/features/auth agent-ui/src/features/admin agent-ui/src/features/portal agent-ui/src/lib/api.ts agent-ui/package.json
git commit -m "feat: split frontend into portal and admin shells"
```

## Task 6: Migrate Zendesk settings into the shared persistence model

**Files:**
- Modify: `agent-api/src/integrations/zendesk/settings-store.ts`
- Modify: `agent-api/src/integrations/zendesk/router.ts`
- Modify: `agent-api/src/integrations/zendesk/service.ts`
- Test: `agent-api/src/admin/router.test.ts`

- [ ] **Step 1: Write failing test that admin overview can read Zendesk integration state from shared persistence**

```ts
it("loads zendesk readiness from persisted integration config", async () => {
  await integrationRepository.upsert({
    key: "zendesk",
    config: {
      enabled: true,
      zendeskBaseUrl: "https://example.zendesk.com",
      zendeskEmail: "bot@example.com"
    }
  });

  const overview = await service.getOverview();
  expect(overview.settings.enabled).toBe(true);
  expect(overview.missing).toContain("zendesk_api_token");
});
```

- [ ] **Step 2: Replace file-backed Zendesk settings store with repository-backed integration config reader**

```ts
export class ZendeskSettingsStore {
  async get() {
    return await integrationRepository.getZendeskSettings();
  }
}
```

- [ ] **Step 3: Keep the existing Zendesk module boundary, but route persistence through shared tables**

```ts
const settings = await integrationRepository.upsert({
  key: "zendesk",
  config: payload
});
```

- [ ] **Step 4: Run targeted backend tests**

Run: `cd agent-api && pnpm test`
Expected: auth, admin, and repository tests remain green.

- [ ] **Step 5: Commit**

```bash
git add agent-api/src/integrations/zendesk agent-api/src/admin/router.test.ts
git commit -m "refactor: move zendesk settings into shared persistence"
```

## Self-Review Checklist

- Spec coverage:
  - Persistence foundation is covered by Tasks 1 and 2.
  - DingTalk login and user model are covered by Task 3.
  - Admin shell and policy-governed employee portal are covered by Tasks 4 and 5.
  - Shared integration persistence is covered by Task 6.
- Placeholder scan:
  - No `TODO`, `TBD`, or "implement later" markers remain in the task steps.
- Type consistency:
  - The plan consistently uses `RuntimeSession`, `ThreadRepository`, `run profile`, and `skill package` naming from the approved design.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-27-agent-studio-cloud-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
