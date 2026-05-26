import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createServiceTokenMiddleware } from "./service-token.js";

describe("createServiceTokenMiddleware", () => {
  function buildApp(token: string | undefined, handler = vi.fn((_req, res) => res.json({ ok: true }))) {
    const app = express();
    app.use(createServiceTokenMiddleware(token));
    app.get("/internal", handler);
    return { app, handler };
  }

  it("rejects requests when the service token is not configured", async () => {
    const { app, handler } = buildApp(undefined);

    const response = await request(app).get("/internal").expect(503);

    expect(response.body).toEqual({ detail: "Service token is not configured" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid bearer tokens", async () => {
    const { app, handler } = buildApp("expected-token");

    await request(app).get("/internal").expect(401);
    await request(app).get("/internal").set("Authorization", "Bearer wrong-token").expect(401);

    expect(handler).not.toHaveBeenCalled();
  });

  it("allows requests with the configured bearer token", async () => {
    const { app, handler } = buildApp("expected-token");

    const response = await request(app).get("/internal").set("Authorization", "Bearer expected-token").expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });
});
