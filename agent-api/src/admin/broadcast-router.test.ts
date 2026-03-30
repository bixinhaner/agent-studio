import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createBroadcastAdminRouter } from "./broadcast-router.js";

function buildApp(options?: {
  broadcasts?: Partial<Parameters<typeof createBroadcastAdminRouter>[0]["broadcasts"]>;
  service?: Partial<Parameters<typeof createBroadcastAdminRouter>[0]["service"]>;
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = {
      id: "admin-1",
      role: "admin",
      createdAt: new Date("2026-03-31T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-03-31T00:00:00.000Z").toISOString()
    };
    next();
  });
  app.use(
    "/api/admin",
    createBroadcastAdminRouter({
      broadcasts: {
        list: vi.fn(async () => [
          {
            id: "broadcast-1",
            title: "Heads up",
            bodyMarkdown: "Message",
            status: "draft",
            dingtalkDeliveryEnabled: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            targets: [{ id: "target-1", broadcastId: "broadcast-1", targetType: "department", targetId: "dept-1", createdAt: new Date().toISOString() }]
          }
        ]),
        ...options?.broadcasts
      },
      service: {
        createDraft: vi.fn(async ({ title, bodyMarkdown, dingtalkDeliveryEnabled, targets }) => ({
          id: "broadcast-2",
          title,
          bodyMarkdown,
          status: "draft",
          dingtalkDeliveryEnabled: Boolean(dingtalkDeliveryEnabled),
          createdByUserId: "admin-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          targets: targets.map((target: { targetType: string; targetId?: string | null }, index: number) => ({ id: `target-${index + 1}`, broadcastId: "broadcast-2", targetType: target.targetType, targetId: target.targetId ?? undefined, createdAt: new Date().toISOString() }))
        })),
        updateDraft: vi.fn(async ({ id, title, bodyMarkdown, dingtalkDeliveryEnabled, targets }) => ({
          id,
          title: title ?? "Heads up",
          bodyMarkdown: bodyMarkdown ?? "Message",
          status: "draft",
          dingtalkDeliveryEnabled: Boolean(dingtalkDeliveryEnabled),
          createdByUserId: "admin-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          targets: (targets ?? []).map((target: { targetType: string; targetId?: string | null }, index: number) => ({ id: `target-${index + 1}`, broadcastId: id, targetType: target.targetType, targetId: target.targetId ?? undefined, createdAt: new Date().toISOString() }))
        })),
        publish: vi.fn(async ({ broadcastId }) => ({
          id: broadcastId,
          title: "Heads up",
          bodyMarkdown: "Message",
          status: "published",
          dingtalkDeliveryEnabled: false,
          publishedByUserId: "admin-1",
          publishedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          targets: [{ id: "target-1", broadcastId, targetType: "department", targetId: "dept-1", createdAt: new Date().toISOString() }]
        })),
        ...options?.service
      }
    })
  );
  return app;
}

describe("createBroadcastAdminRouter", () => {
  it("lists, creates, updates, and publishes broadcasts", async () => {
    const app = buildApp();

    const list = await request(app).get("/api/admin/broadcasts");
    expect(list.status).toBe(200);
    expect(list.body.broadcasts).toHaveLength(1);

    const create = await request(app)
      .post("/api/admin/broadcasts")
      .send({ title: "New", body_markdown: "Hello", dingtalk_delivery_enabled: true, targets: [{ target_type: "department", target_id: "dept-2" }] });
    expect(create.status).toBe(200);
    expect(create.body.broadcast.id).toBe("broadcast-2");
    expect(create.body.broadcast.dingtalkDeliveryEnabled).toBe(true);

    const update = await request(app)
      .patch("/api/admin/broadcasts/broadcast-2")
      .send({ title: "Updated", targets: [{ target_type: "role", target_id: "role-1" }] });
    expect(update.status).toBe(200);
    expect(update.body.broadcast.title).toBe("Updated");

    const publish = await request(app).post("/api/admin/broadcasts/broadcast-2/publish");
    expect(publish.status).toBe(200);
    expect(publish.body.broadcast.status).toBe("published");
  });

  it("maps broadcast not found to 404", async () => {
    const app = buildApp({
      service: {
        publish: vi.fn(async () => {
          throw new Error("broadcast not found");
        })
      }
    });

    const response = await request(app).post("/api/admin/broadcasts/broadcast-missing/publish");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: "broadcast not found" });
  });
});
