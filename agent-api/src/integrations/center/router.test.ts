import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createIntegrationCenterRouter } from "./router.js";

function buildApp(options?: { detailAccessDenied?: boolean }) {
  const service = {
    async listInstances() {
      return { items: [] };
    },
    async getInstanceDetail() {
      if (options?.detailAccessDenied) {
        throw new Error("integration instance access denied");
      }
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
        config: { defaultModel: "gpt-5.4-mini" },
        secretState: { hasSecrets: false },
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
        config: { defaultModel: "gpt-5.4-mini" },
        secretState: { hasSecrets: true, rotatedAt: "2026-03-29T00:00:00.000Z", rotatedByUserId: "admin-1" },
        validationHistory: { items: [] },
        bindings: { items: [] },
        policies: { summary: { allow: { roles: [], departments: [], users: [] }, deny: { roles: [], departments: [], users: [] } }, items: [] }
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
          config: { defaultModel: "gpt-5.4-mini" },
          secretState: { hasSecrets: true, rotatedAt: "2026-03-29T00:00:00.000Z", rotatedByUserId: "admin-1" },
          validationHistory: { items: [] },
          bindings: { items: [] },
          policies: { summary: { allow: { roles: [], departments: [], users: [] }, deny: { roles: [], departments: [], users: [] } }, items: [] }
        }
      };
    },
    async listValidationHistory() {
      return { items: [] };
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

  return { app };
}

describe("createIntegrationCenterRouter", () => {
  it("rejects secret-like config keys at the HTTP contract layer", async () => {
    const { app } = buildApp();

    const response = await request(app).post("/api/admin/integrations").send({
      type: "openai_codex",
      slug: "openai-primary",
      name: "OpenAI Platform",
      status: "active",
      config: {
        defaultModel: "gpt-5.4-mini",
        clientSecret: "super-secret"
      },
      secretState: {
        clientSecret: "super-secret"
      }
    });

    expect(response.status).toBe(400);
    expect(response.body.detail).toMatch(/secret/i);
  });

  it("denies access to instances that are not authorized by resource policy", async () => {
    const { app } = buildApp({ detailAccessDenied: true });

    const response = await request(app).get("/api/admin/integrations/int-zendesk-1");

    expect(response.status).toBe(403);
  });

  it("returns policy summaries for authorized instances", async () => {
    const { app } = buildApp();

    const response = await request(app).get("/api/admin/integrations/int-zendesk-1/policies");

    expect(response.status).toBe(200);
    expect(response.body.summary.allow.roles).toContain("role-support-admin");
    expect(response.body.summary.deny.users).toContain("user-9");
  });
});
