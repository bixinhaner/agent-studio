import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createCurrentUserMiddleware } from "../auth/current-user.js";
import { requireCurrentUser, requireRole } from "../auth/current-user.js";
import { createSessionCookieManager } from "../auth/session-cookie.js";
import { createOrgSyncRouter } from "./org-sync-router.js";
import type { AuthenticatedUser, UserRecord, UserRepositoryLike } from "../persistence/user-repository.js";

class FakeUserRepository implements UserRepositoryLike {
  constructor(private readonly users = new Map<string, AuthenticatedUser>()) {}

  async getById(id: string): Promise<AuthenticatedUser | undefined> {
    return this.users.get(id);
  }

  async getByExternalId(externalId: string): Promise<AuthenticatedUser | undefined> {
    for (const user of this.users.values()) {
      if (user.externalId === externalId) return user;
    }
    return undefined;
  }

  async upsertFromDingTalk(): Promise<AuthenticatedUser> {
    throw new Error("not used in org sync router tests");
  }

  async updateLocalSettings(): Promise<UserRecord> {
    throw new Error("not used in org sync router tests");
  }

  seed(user: AuthenticatedUser): void {
    this.users.set(user.id, user);
  }
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: overrides.id ?? "admin-1",
    externalId: overrides.externalId ?? "ding-admin-1",
    email: overrides.email ?? "admin@example.com",
    displayName: overrides.displayName ?? "Admin",
    role: overrides.role ?? "admin",
    status: overrides.status ?? "active",
    createdAt: overrides.createdAt ?? new Date("2026-03-29T00:00:00.000Z").toISOString(),
    updatedAt: overrides.updatedAt ?? new Date("2026-03-29T00:00:00.000Z").toISOString()
  };
}

type FakeSyncJobRow = {
  id: string;
  organizationId: string | null;
  provider: string;
  scopeType: string;
  scopeExternalId: string | null;
  status: string;
  triggerType: string;
  triggeredByUserId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  summary: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type FakeSyncEventRow = {
  id: string;
  syncJobId: string;
  level: string;
  eventType: string;
  message: string;
  payload: unknown;
  createdAt: Date;
};

type FakeSyncDiffRow = {
  id: string;
  syncJobId: string;
  entityType: string;
  entityExternalId: string | null;
  changeType: string;
  beforePayload: unknown;
  afterPayload: unknown;
  createdAt: Date;
};

class FakeSyncJobRepository {
  constructor(
    readonly jobs: FakeSyncJobRow[] = [],
    readonly events: FakeSyncEventRow[] = [],
    readonly diffs: FakeSyncDiffRow[] = []
  ) {}

  async listRecent(): Promise<FakeSyncJobRow[]> {
    return this.jobs.map((job) => ({ ...job }));
  }

  async getDetail(jobId: string): Promise<{
    id: string;
    status: string;
    summary: unknown;
    events: FakeSyncEventRow[];
    diffs: FakeSyncDiffRow[];
  } | null> {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) return null;
    return {
      id: job.id,
      status: job.status,
      summary: job.summary,
      events: this.events.filter((event) => event.syncJobId === jobId),
      diffs: this.diffs.filter((diff) => diff.syncJobId === jobId)
    };
  }
}

function buildApp(options?: {
  user?: AuthenticatedUser;
  syncService?: { run: ReturnType<typeof vi.fn> };
  syncJobs?: FakeSyncJobRepository;
}) {
  const users = new FakeUserRepository();
  const user = options?.user ?? makeUser();
  users.seed(user);

  const cookies = createSessionCookieManager({
    cookieName: "agent_studio_session",
    secret: "test-session-secret",
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    secure: false,
    sameSite: "lax"
  });

  const app = express();
  app.use(express.json());

  app.use(createCurrentUserMiddleware({ users, cookies }));
  app.use(
    "/api/admin/org-sync",
    requireCurrentUser,
    requireRole("admin"),
    createOrgSyncRouter({
      syncService:
        options?.syncService ??
        ({
          run: vi.fn().mockResolvedValue({ jobId: "job-1", status: "succeeded" })
        } as never),
      syncJobs:
        options?.syncJobs ??
        new FakeSyncJobRepository(
          [
            {
              id: "job-1",
              organizationId: null,
              provider: "dingtalk",
              scopeType: "full",
              scopeExternalId: null,
              status: "succeeded",
              triggerType: "manual",
              triggeredByUserId: user.id,
              startedAt: new Date("2026-03-29T01:00:00.000Z"),
              finishedAt: new Date("2026-03-29T01:01:00.000Z"),
              summary: { total: 1 },
              createdAt: new Date("2026-03-29T01:00:00.000Z"),
              updatedAt: new Date("2026-03-29T01:01:00.000Z")
            }
          ],
          [
            {
              id: "event-1",
              syncJobId: "job-1",
              level: "info",
              eventType: "remote_fetch_started",
              message: "Organization fetch started",
              payload: { scopeType: "full" },
              createdAt: new Date("2026-03-29T01:00:01.000Z")
            }
          ],
          [
            {
              id: "diff-1",
              syncJobId: "job-1",
              entityType: "user",
              entityExternalId: "ding-u1",
              changeType: "updated",
              beforePayload: { status: "disabled" },
              afterPayload: { status: "active" },
              createdAt: new Date("2026-03-29T01:00:02.000Z")
            }
          ]
        )
    } as never)
  );

  return { app, cookies, user, users };
}

describe("org sync admin router", () => {
  it("triggers a full org sync for admin users", async () => {
    const syncRun = vi.fn().mockResolvedValue({ jobId: "job-2", status: "succeeded" });
    const { app, cookies, user } = buildApp({
      user: makeUser({ id: "admin-1", role: "admin" }),
      syncService: { run: syncRun }
    });

    const response = await request(app)
      .post("/api/admin/org-sync/jobs")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(202);
    expect(syncRun).toHaveBeenCalledWith({
      scopeType: "full",
      triggerType: "manual",
      triggeredByUserId: user.id
    });
  });

  it("returns job detail, events, and diffs from persistence", async () => {
    const { app, cookies, user } = buildApp({
      user: makeUser({ id: "admin-1", role: "admin" })
    });

    const listResponse = await request(app)
      .get("/api/admin/org-sync/jobs")
      .set("Cookie", cookies.create(user.id));

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.jobs).toEqual([
      expect.objectContaining({ id: "job-1", status: "succeeded", summary: { total: 1 } })
    ]);

    const detailResponse = await request(app)
      .get("/api/admin/org-sync/jobs/job-1")
      .set("Cookie", cookies.create(user.id));

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.job).toMatchObject({
      id: "job-1",
      status: "succeeded",
      summary: { total: 1 }
    });

    const eventsResponse = await request(app)
      .get("/api/admin/org-sync/jobs/job-1/events")
      .set("Cookie", cookies.create(user.id));

    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.body.events).toEqual([
      expect.objectContaining({ eventType: "remote_fetch_started", message: "Organization fetch started" })
    ]);

    const diffsResponse = await request(app)
      .get("/api/admin/org-sync/jobs/job-1/diffs")
      .set("Cookie", cookies.create(user.id));

    expect(diffsResponse.status).toBe(200);
    expect(diffsResponse.body.diffs).toEqual([
      expect.objectContaining({ entityType: "user", entityExternalId: "ding-u1", changeType: "updated" })
    ]);
  });

  it("returns a clear conflict when org sync is already running", async () => {
    const syncRun = vi.fn().mockRejectedValue(new Error("org sync is already running"));
    const { app, cookies, user } = buildApp({
      user: makeUser({ id: "admin-1", role: "admin" }),
      syncService: { run: syncRun }
    });

    const response = await request(app)
      .post("/api/admin/org-sync/jobs")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ detail: "org sync is already running" });
  });

  it("surfaces provider failures as a 502 detail response", async () => {
    const syncRun = vi.fn().mockResolvedValue({ jobId: "job-2", status: "failed" });
    const jobs = new FakeSyncJobRepository([
      {
        id: "job-2",
        organizationId: null,
        provider: "dingtalk",
        scopeType: "full",
        scopeExternalId: null,
        status: "failed",
        triggerType: "manual",
        triggeredByUserId: "admin-1",
        startedAt: new Date("2026-03-29T01:00:00.000Z"),
        finishedAt: new Date("2026-03-29T01:01:00.000Z"),
        summary: { detail: "DingTalk API unavailable" },
        createdAt: new Date("2026-03-29T01:00:00.000Z"),
        updatedAt: new Date("2026-03-29T01:01:00.000Z")
      }
    ]);
    const { app, cookies, user } = buildApp({
      user: makeUser({ id: "admin-1", role: "admin" }),
      syncService: { run: syncRun },
      syncJobs: jobs
    });

    const response = await request(app)
      .post("/api/admin/org-sync/jobs")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      detail: "DingTalk API unavailable",
      job: expect.objectContaining({ id: "job-2", status: "failed" })
    });
  });
});
