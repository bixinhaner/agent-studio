import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createOrgSyncRouter } from "./org-sync-router.js";

describe("createOrgSyncRouter", () => {
  it("returns readable department and user lookup data with sync diffs", async () => {
    const app = express();
    app.use(
      createOrgSyncRouter({
        syncService: {
          run: vi.fn(async () => ({ jobId: "job-1", status: "succeeded" as const }))
        },
        syncJobs: {
          listRecent: vi.fn(async () => []),
          getDetail: vi.fn(async () => ({
            id: "job-1",
            provider: "dingtalk",
            scopeType: "full",
            status: "succeeded",
            triggerType: "manual",
            summary: { total: 1 },
            events: [],
            snapshots: [
              {
                id: "snapshot-1",
                entityType: "department",
                scopeType: "full",
                snapshotPayload: [
                  {
                    externalId: "dept-parent",
                    name: "研发部",
                    parentExternalId: null
                  },
                  {
                    externalId: "dept-child",
                    name: "平台软件部",
                    parentExternalId: "dept-parent"
                  }
                ],
                createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString()
              },
              {
                id: "snapshot-2",
                entityType: "user",
                scopeType: "full",
                snapshotPayload: [
                  {
                    userId: "ding-user-1",
                    unionId: "union-1",
                    displayName: "张三",
                    email: "zhangsan@example.com"
                  }
                ],
                createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString()
              }
            ],
            diffs: [
              {
                id: "diff-1",
                entityType: "membership",
                entityExternalId: "union-1",
                changeType: "primary_changed",
                beforePayload: {
                  userId: "union-1",
                  memberships: [{ departmentId: "dept-parent", isPrimary: true }]
                },
                afterPayload: {
                  userId: "union-1",
                  memberships: [{ departmentId: "dept-child", isPrimary: true }]
                },
                createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString()
              }
            ],
            createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
            updatedAt: new Date("2026-04-01T00:00:00.000Z").toISOString()
          }))
        },
        departments: {
          listTree: vi.fn(async () => [])
        },
        users: {
          getByExternalId: vi.fn(async () => undefined),
          getById: vi.fn(async () => undefined)
        },
        quotaChecks: {
          evaluate: vi.fn(async () => ({
            decision: "allow" as const,
            observedValue: 0,
            evaluatedPolicies: []
          }))
        }
      })
    );

    const response = await request(app).get("/jobs/job-1/diffs").expect(200);

    expect(response.body.diffs).toHaveLength(1);
    expect(response.body.departmentLookup).toMatchObject({
      "dept-parent": {
        externalId: "dept-parent",
        name: "研发部",
        path: "研发部"
      },
      "dept-child": {
        externalId: "dept-child",
        name: "平台软件部",
        path: "研发部 / 平台软件部"
      }
    });
    expect(response.body.userLookup).toMatchObject({
      "union-1": {
        key: "union-1",
        displayName: "张三",
        email: "zhangsan@example.com",
        userId: "ding-user-1",
        unionId: "union-1"
      },
      "ding-user-1": {
        key: "ding-user-1",
        displayName: "张三",
        email: "zhangsan@example.com",
        userId: "ding-user-1",
        unionId: "union-1"
      }
    });
  });
});
