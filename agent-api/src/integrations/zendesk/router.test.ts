import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createZendeskAdminRouter } from "./router.js";

describe("createZendeskAdminRouter", () => {
  it("forwards instance_id through overview requests", async () => {
    const app = express();
    app.use(express.json());
    const getOverview = vi.fn().mockResolvedValue({ ok: true });
    app.use(
      "/api/integrations/zendesk",
      createZendeskAdminRouter({
        getOverview,
        async updateSettings() {
          return { ok: true };
        }
      } as never)
    );

    const response = await request(app).get("/api/integrations/zendesk/overview?instance_id=int-zendesk-primary");

    expect(response.status).toBe(200);
    expect(getOverview).toHaveBeenCalledWith("int-zendesk-primary");
  });

  it("forwards instance_id through compatibility routes for Integration Center-backed editing", async () => {
    const app = express();
    app.use(express.json());
    const updateSettings = vi.fn().mockResolvedValue({ ok: true });
    const getOverview = vi.fn().mockResolvedValue({ ok: true });
    app.use(
      "/api/integrations/zendesk",
      createZendeskAdminRouter({
        getOverview,
        updateSettings
      } as never)
    );

    const response = await request(app)
      .put("/api/integrations/zendesk/settings")
      .send({
        instance_id: "int-zendesk-primary",
        zendesk_api_token: "",
        webhook_signing_secret: ""
      });

    expect(response.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        zendeskApiToken: "",
        webhookSigningSecret: ""
      }),
      "int-zendesk-primary"
    );
  });

  it("passes explicit empty secrets through settings updates so they can be cleared", async () => {
    const app = express();
    app.use(express.json());
    const updateSettings = vi.fn().mockResolvedValue({ ok: true });
    app.use(
      "/api/integrations/zendesk",
      createZendeskAdminRouter({
        async getOverview() {
          return { ok: true };
        },
        updateSettings
      } as never)
    );

    const response = await request(app).put("/api/integrations/zendesk/settings").send({
      zendesk_api_token: "",
      webhook_signing_secret: ""
    });

    expect(response.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        zendeskApiToken: "",
        webhookSigningSecret: ""
      })
    );
  });
  it("returns a controlled 500 response when overview loading fails", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api/integrations/zendesk",
      createZendeskAdminRouter({
        async getOverview() {
          throw new Error("db unavailable");
        }
      } as never)
    );

    const response = await request(app).get("/api/integrations/zendesk/overview");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ detail: "db unavailable" });
  });
});
