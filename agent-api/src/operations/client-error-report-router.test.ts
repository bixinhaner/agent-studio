import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { registerCommonApiRoutes } from "../app-routes.js";
import { createClientErrorReportRouter } from "./client-error-report-router.js";

function createApp(options: { now?: () => number } = {}) {
  const lines: string[] = [];
  const app = express();
  app.use(express.json());
  registerCommonApiRoutes(app, {
    currentUserMiddleware: (req, _res, next) => {
      if (req.header("x-test-user")) {
        req.currentUser = { id: req.header("x-test-user"), status: "active" } as never;
        req.currentOrganization = { id: "organization-1", type: "internal" } as never;
      }
      next();
    },
    authRouter: Router(),
    adminRouter: Router() as never,
    portalRouter: Router(),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    zendeskRouter: Router(),
    clientErrorReportRouter: createClientErrorReportRouter({ now: options.now, log: (line) => lines.push(line) })
  });
  return { app, lines };
}

const report = {
  source: "portal-thread",
  name: "Error",
  message: "Minified React error #310",
  stack: "Error: Minified React error #310\n    at ProcessDataPart",
  component_stack: "\n    in ProcessDataPart",
  thread_id: "thread-1",
  build_id: "abc123",
  locale: "zh-CN",
  url_path: "/"
};

function parse(line: string) {
  expect(line.startsWith("[portal-client-error] ")).toBe(true);
  return JSON.parse(line.slice("[portal-client-error] ".length));
}

describe("client error report router", () => {
  it("requires a signed-in portal user", async () => {
    const { app, lines } = createApp();
    await request(app).post("/api/client-errors").send(report).expect(401);
    expect(lines).toEqual([]);
  });

  it("logs one structured line with the reporting user and thread", async () => {
    const { app, lines } = createApp();
    await request(app).post("/api/client-errors").set("x-test-user", "user-1").send(report).expect(202);
    expect(lines).toHaveLength(1);
    expect(parse(lines[0])).toEqual(expect.objectContaining({
      source: "portal-thread",
      user_id: "user-1",
      organization_id: "organization-1",
      thread_id: "thread-1",
      message: "Minified React error #310",
      build_id: "abc123"
    }));
  });

  it("rejects malformed reports", async () => {
    const { app, lines } = createApp();
    await request(app).post("/api/client-errors").set("x-test-user", "user-1").send({ message: 1 }).expect(400);
    expect(lines).toEqual([]);
  });

  it("drops duplicates within a minute and caps reports per user", async () => {
    let now = 1_000_000;
    const { app, lines } = createApp({ now: () => now });
    const send = (body: Record<string, unknown>, user = "user-1") =>
      request(app).post("/api/client-errors").set("x-test-user", user).send(body).expect(202);

    await send(report);
    const duplicate = await send(report);
    expect(duplicate.body).toEqual({ ok: true, dropped: true });
    expect(lines).toHaveLength(1);

    now += 61_000;
    await send(report);
    expect(lines).toHaveLength(2);

    for (let index = 0; index < 30; index += 1) {
      await send({ ...report, thread_id: `thread-${index + 2}` });
    }
    expect(lines).toHaveLength(20);

    await send(report, "user-2");
    expect(lines).toHaveLength(21);

    now += 10 * 60 * 1000 + 1;
    await send({ ...report, thread_id: "after-window" });
    expect(lines).toHaveLength(22);
  });
});
