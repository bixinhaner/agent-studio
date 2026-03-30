import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createIntegrationCenterRouter } from "./router.js";

function buildApp() {
  const service = {
    async listInstances() {
      return {
        items: [
          {
            id: "int-zendesk-1",
            type: "zendesk",
            slug: "zendesk-main",
            name: "Zendesk Main",
            description: "primary",
            status: "active",
            isSystemSingleton: false,
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z"
          }
        ]
      };
    },
    async getInstanceDetail() {
      return {
        instance: {
          id: "int-zendesk-1",
          type: "zendesk",
          slug: "zendesk-main",
          name: "Zendesk Main",
          description: "primary",
          status: "active",
          isSystemSingleton: false,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        config: { zendeskBaseUrl: "https://example.zendesk.com" },
        secretState: { hasSecrets: true, rotatedAt: "2026-03-29T00:00:00.000Z", rotatedByUserId: "admin-1" },
        validationHistory: { items: [] },
        bindings: { items: [] },
        policies: { summary: { allow: { roles: [], departments: [], users: [] }, deny: { roles: [], departments: [], users: [] } }, items: [] }
      };
    },
    async saveInstance() {
      return {
        instance: {
          id: "int-openai-1",
          type: "openai_codex",
          slug: "openai-primary",
          name: "OpenAI Platform",
          description: null,
          status: "active",
          isSystemSingleton: true,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        config: { apiKey: "redacted" },
        secretState: { hasSecrets: true, rotatedAt: "2026-03-29T00:00:00.000Z", rotatedByUserId: "admin-1" }
      };
    },
    async validateInstance() {
      return {
        validation: {
          id: "validation-1",
          triggerType: "manual",
          status: "success",
          summary: { ok: true },
          detail: { message: "validated" },
          triggeredByUserId: "admin-1",
          createdAt: "2026-03-30T10:00:00.000Z"
        },
        detail: {
          instance: {
            id: "int-openai-1",
            type: "openai_codex",
            slug: "openai-primary",
            name: "OpenAI Platform",
            description: null,
            status: "active",
            isSystemSingleton: true,
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z"
          },
          config: { apiKey: "redacted" },
          secretState: { hasSecrets: true, rotatedAt: "2026-03-29T00:00:00.000Z", rotatedByUserId: "admin-1" },
          validationHistory: { items: [] },
          bindings: { items: [] },
          policies: { summary: { allow: { roles: [], departments: [], users: [] }, deny: { roles: [], departments: [], users: [] } }, items: [] }
        }
      };
    },
    async listValidationHistory() {
      return { items: [{ id: "validation-1", triggerType: "manual", status: "success", createdAt: "2026-03-30T10:00:00.000Z" }] };
    },
    async getPolicies() {
      return {
        summary: {
          allow: { roles: ["role-support-admin"], departments: [], users: [] },
          deny: { roles: [], departments: [], users: ["user-9"] }
        },
        items: [
          { subjectType: "role", subjectId: "role-support-admin", effect: "allow" },
          { subjectType: "user", subjectId: "user-9", effect: "deny" }
        ]
      };
    },
    async replacePolicies() {
      return {
        summary: {
          allow: { roles: ["role-support-admin"], departments: [], users: [] },
          deny: { roles: [], departments: [], users: ["user-9"] }
        },
        items: [
          { subjectType: "role", subjectId: "role-support-admin", effect: "allow" },
          { subjectType: "user", subjectId: "user-9", effect: "deny" }
        ]
      };
    }
  } as never;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = {
      id: "admin-1",
      role: "admin",
      status: "active",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z"
    };
    next();
  });
  app.use(
    "/api/admin",
    createIntegrationCenterRouter({
      service,
      requirePermission: () => (_req, _res, next) => next()
    })
  );

  return { app, service };
}

describe("createIntegrationCenterRouter", () => {
  it("lists integration instances by type for admins", async () => {
    const { app } = buildApp();

    const response = await request(app).get("/api/admin/integrations?type=zendesk");

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ type: "zendesk" });
  });

  it("creates, validates, and reads validation history for an integration instance", async () => {
    const { app } = buildApp();

    const saveResponse = await request(app).post("/api/admin/integrations").send({
      type: "openai_codex",
      slug: "openai-primary",
      name: "OpenAI Platform",
      status: "active",
      config: { apiKey: "sk-test", defaultModel: "gpt-5.4-mini" }
    });

    expect(saveResponse.status).toBe(201);
    expect(saveResponse.body.instance).toMatchObject({
      type: "openai_codex",
      name: "OpenAI Platform"
    });

    const validateResponse = await request(app).post("/api/admin/integrations/int-openai-1/validate").send({});
    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body.validation.status).toBe("success");

    const historyResponse = await request(app).get("/api/admin/integrations/int-openai-1/history");
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.items[0]).toMatchObject({ triggerType: "manual" });
  });

  it("returns and replaces resource policies for an integration instance", async () => {
    const { app } = buildApp();

    const getResponse = await request(app).get("/api/admin/integrations/int-zendesk-1/policies");
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.summary.allow.roles).toContain("role-support-admin");

    const putResponse = await request(app)
      .put("/api/admin/integrations/int-zendesk-1/policies")
      .send({
        roleAllowIds: ["role-support-admin"],
        userDenyIds: ["user-9"]
      });

    expect(putResponse.status).toBe(200);
    expect(putResponse.body.summary.deny.users).toContain("user-9");
  });
});
