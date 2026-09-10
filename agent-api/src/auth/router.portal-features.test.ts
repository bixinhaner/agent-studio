import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAuthRouter } from "./router.js";
import { normalizeSystemSettingsPayload, parseSystemSettingsPayloadPatch, type SystemSettingsVersionRecord } from "../system-settings/types.js";

function harness(email?: string, payload?: unknown) {
  const reader = { getCurrentPublished: vi.fn(async () => payload === undefined ? undefined : ({ payload: normalizeSystemSettingsPayload(payload) }) as SystemSettingsVersionRecord) };
  const app = express();
  app.use((req, _res, next) => {
    if (email !== undefined) req.currentUser = { id: "viewer", email, status: "active" } as typeof req.currentUser;
    next();
  });
  app.use("/api/auth", createAuthRouter({ systemSettings: reader } as unknown as Parameters<typeof createAuthRouter>[0]));
  return { app, reader };
}

describe("Portal entry visibility from published settings", () => {
  it("requires sign-in and never exposes the configured email list", async () => {
    const { app } = harness(undefined, { localBridgeVisibility: { mode: "all", emails: ["private@example.com"] } });
    await request(app).get("/api/auth/portal-features").expect(401);
  });

  it("preserves the existing pilot scope when old settings have no visibility field", async () => {
    expect((await request(harness("like@baicells.com", {}).app).get("/api/auth/portal-features")).body).toEqual({ local_bridge_visible: true });
    expect((await request(harness("other@example.com", {}).app).get("/api/auth/portal-features")).body).toEqual({ local_bridge_visible: false });
  });

  it("matches normalized login emails and returns only the display boolean", async () => {
    const { app } = harness(" Person@Example.com ", { localBridgeVisibility: { mode: "selected", emails: ["PERSON@example.com", "private@example.com"] } });
    const res = await request(app).get("/api/auth/portal-features").expect(200);
    expect(res.body).toEqual({ local_bridge_visible: true });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it.each([
    ["hidden", ["like@baicells.com"], false],
    ["selected", [], false],
    ["selected", ["someone@example.com"], false],
    ["all", [], true]
  ])("respects %s mode with %j", async (mode, emails, visible) => {
    const { app } = harness("like@baicells.com", { localBridgeVisibility: { mode, emails } });
    expect((await request(app).get("/api/auth/portal-features")).body).toEqual({ local_bridge_visible: visible });
  });

  it("reads newly published settings without restarting", async () => {
    const { app, reader } = harness("like@baicells.com", { localBridgeVisibility: { mode: "hidden", emails: [] } });
    await request(app).get("/api/auth/portal-features").expect(200, { local_bridge_visible: false });
    reader.getCurrentPublished.mockResolvedValue({ payload: normalizeSystemSettingsPayload({ localBridgeVisibility: { mode: "selected", emails: ["like@baicells.com"] } }) } as SystemSettingsVersionRecord);
    await request(app).get("/api/auth/portal-features").expect(200, { local_bridge_visible: true });
  });

  it("returns a retryable error when settings cannot be read", async () => {
    const { app, reader } = harness("like@baicells.com");
    reader.getCurrentPublished.mockRejectedValue(new Error("unavailable"));
    await request(app).get("/api/auth/portal-features").expect(503);
  });

  it("rejects invalid emails and keeps explicit empty lists instead of restoring defaults", () => {
    expect(() => parseSystemSettingsPayloadPatch({ localBridgeVisibility: { mode: "selected", emails: ["invalid"] } })).toThrow();
    expect(normalizeSystemSettingsPayload({ localBridgeVisibility: { emails: [] } }).localBridgeVisibility).toEqual({ mode: "selected", emails: [] });
    expect(normalizeSystemSettingsPayload({ localBridgeVisibility: { emails: [" Person@Example.com ", "person@example.com"] } }).localBridgeVisibility.emails).toEqual(["person@example.com"]);
  });
});
