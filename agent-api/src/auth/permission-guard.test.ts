import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedUser } from "../persistence/user-repository.js";
import { createRequirePermission } from "./permission-guard.js";

function buildPermissionGuardApp(input: {
  currentUser?: AuthenticatedUser;
  allowedPermissions?: string[];
  securityAlerts?: { evaluateSecurityEvent: ReturnType<typeof vi.fn> };
  departmentIds?: string[];
}) {
  const app = express();
  const requirePermission = createRequirePermission(
    {
      hasPermission: async ({ permissionKey }) => (input.allowedPermissions ?? []).includes(permissionKey)
    },
    input.securityAlerts
      ? {
          resourceAccessLogs: {
            record: vi.fn(async () => ({}))
          },
          listDepartmentIdsForUser: async () => input.departmentIds ?? ["dept-rd"],
          securityAlerts: input.securityAlerts,
          countRecentDeniedPermissionsForUser: async () => 3
        }
      : undefined
  );

  app.use((req, _res, next) => {
    req.currentUser = input.currentUser;
    next();
  });

  app.get("/guarded", requirePermission("role.write"), (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

describe("createRequirePermission", () => {
  it("returns 401 when unauthenticated", async () => {
    const response = await request(buildPermissionGuardApp({})).get("/guarded");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "Unauthorized" });
  });

  it("returns 403 when a request lacks the required permission", async () => {
    const response = await request(
      buildPermissionGuardApp({
        currentUser: {
          id: "user-1",
          role: "employee",
          status: "active",
          createdAt: new Date("2026-03-29T00:00:00Z").toISOString(),
          updatedAt: new Date("2026-03-29T00:00:00Z").toISOString()
        }
      })
    ).get("/guarded");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ detail: "Forbidden" });
  });

  it("emits a security alert on denied permission checks when configured", async () => {
    const evaluateSecurityEvent = vi.fn(async () => undefined);
    const response = await request(
      buildPermissionGuardApp({
        currentUser: {
          id: "user-1",
          role: "employee",
          status: "active",
          createdAt: new Date("2026-03-29T00:00:00Z").toISOString(),
          updatedAt: new Date("2026-03-29T00:00:00Z").toISOString()
        },
        securityAlerts: { evaluateSecurityEvent }
      })
    ).get("/guarded");

    expect(response.status).toBe(403);
    expect(evaluateSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "department",
        scopeId: "dept-rd",
        resourceType: "permission",
        resourceId: "role.write",
        actionType: "deny",
        resultStatus: "denied",
        userId: "user-1",
        denialPattern: {
          deniedCount: 3,
          thresholdCount: 3
        }
      })
    );
  });

  it("falls back to a platform-scoped security alert when the user has no department", async () => {
    const evaluateSecurityEvent = vi.fn(async () => undefined);
    const response = await request(
      buildPermissionGuardApp({
        currentUser: {
          id: "user-2",
          role: "employee",
          status: "active",
          createdAt: new Date("2026-03-29T00:00:00Z").toISOString(),
          updatedAt: new Date("2026-03-29T00:00:00Z").toISOString()
        },
        securityAlerts: { evaluateSecurityEvent },
        departmentIds: []
      })
    ).get("/guarded");

    expect(response.status).toBe(403);
    expect(evaluateSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "platform",
        scopeId: "platform"
      })
    );
  });

  it("allows the request when the user has the permission", async () => {
    const response = await request(
      buildPermissionGuardApp({
        currentUser: {
          id: "user-1",
          role: "admin",
          status: "active",
          createdAt: new Date("2026-03-29T00:00:00Z").toISOString(),
          updatedAt: new Date("2026-03-29T00:00:00Z").toISOString()
        },
        allowedPermissions: ["role.write"]
      })
    ).get("/guarded");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
