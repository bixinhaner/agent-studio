import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { registerCommonApiRoutes } from "../app-routes.js";
import {
  PortalSendFailureRepository,
  type PortalSendFailureInput,
  type PortalSendFailureRepositoryDb
} from "../persistence/portal-send-failure-repository.js";
import {
  createPortalSendFailureRecorder,
  createPortalSendFailureRouter,
  portalSendFailureMessageFields
} from "./portal-send-failure-recorder.js";

function createApp(options: { owned?: Record<string, string>; now?: () => number } = {}) {
  const recorded: PortalSendFailureInput[] = [];
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
    sendFailureRouter: createPortalSendFailureRouter({
      record: async (input) => {
        recorded.push(input);
      },
      // The browser may only know its local id; it maps to a thread only for its owner.
      resolveOwnedThreadId: async (rawThreadId, req) =>
        req.currentUser?.id === "user-1" ? options.owned?.[rawThreadId] : undefined,
      now: options.now
    })
  });
  return { app, recorded };
}

const report = {
  stage: "message_save",
  thread_id: "__LOCALID_abc",
  detail: "TypeError: Failed to fetch",
  message_preview: "这个是烽火的OLT，帮我看看配置",
  attachments: [{ name: "image.png", status: "requires-action", size_bytes: 2048 }],
  client_run_id: "run-1",
  build_id: "build-1"
};

describe("portal send failure router", () => {
  it("requires a signed-in portal user", async () => {
    const { app, recorded } = createApp();
    await request(app).post("/api/send-failures").send(report).expect(401);
    expect(recorded).toHaveLength(0);
  });

  it("records a browser-side failure against the caller's own thread", async () => {
    const { app, recorded } = createApp({ owned: { __LOCALID_abc: "thread-1" } });
    const response = await request(app)
      .post("/api/send-failures")
      .set("x-test-user", "user-1")
      .set("user-agent", "vitest-agent")
      .send(report)
      .expect(202);

    expect(response.body).toEqual({ ok: true, thread_id: "thread-1" });
    expect(recorded).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        userId: "user-1",
        organizationId: "organization-1",
        source: "client",
        stage: "message_save",
        detail: "TypeError: Failed to fetch",
        messagePreview: "这个是烽火的OLT，帮我看看配置",
        attachments: [{ name: "image.png", status: "requires-action", sizeBytes: 2048 }],
        clientRunId: "run-1",
        buildId: "build-1",
        userAgent: "vitest-agent"
      })
    ]);
  });

  it("does not attach a report to a thread the caller does not own", async () => {
    const { app, recorded } = createApp({ owned: { __LOCALID_abc: "thread-1" } });
    await request(app).post("/api/send-failures").set("x-test-user", "user-2").send(report).expect(202);
    expect(recorded[0]?.threadId).toBeUndefined();
  });

  it("rejects unknown stages and malformed bodies", async () => {
    const { app, recorded } = createApp();
    await request(app).post("/api/send-failures").set("x-test-user", "user-1").send({ ...report, stage: "drop_table" }).expect(400);
    await request(app).post("/api/send-failures").set("x-test-user", "user-1").send({ stage: "message_save", http_status: "x" }).expect(400);
    expect(recorded).toHaveLength(0);
  });

  it("drops immediate duplicates and caps a flood from one user", async () => {
    let now = 1_000;
    const { app, recorded } = createApp({ now: () => now });
    await request(app).post("/api/send-failures").set("x-test-user", "user-1").send(report).expect(202);
    const duplicate = await request(app).post("/api/send-failures").set("x-test-user", "user-1").send(report).expect(202);
    expect(duplicate.body).toEqual({ ok: true, dropped: true });
    for (let index = 0; index < 40; index += 1) {
      now += 10;
      await request(app)
        .post("/api/send-failures")
        .set("x-test-user", "user-1")
        .send({ ...report, client_run_id: `run-${index + 2}` });
    }
    expect(recorded).toHaveLength(30);
  });
});

describe("portal send failure recorder", () => {
  it("persists the record and logs one line without the message text", async () => {
    const lines: string[] = [];
    const create = vi.fn(async () => ({}) as never);
    const record = createPortalSendFailureRecorder({ store: { create }, log: (line) => lines.push(line) });

    await record({
      threadId: "thread-1",
      userId: "user-1",
      source: "server",
      stage: "message_save",
      errorCode: "P2024",
      httpStatus: 400,
      detail: "Timed out fetching a new connection from the connection pool",
      messagePreview: "secret question text",
      attachments: [{ name: "a.pdf" }]
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[portal-send-failure\] /);
    const logged = JSON.parse(lines[0].slice("[portal-send-failure] ".length));
    expect(logged).toEqual(expect.objectContaining({ stage: "message_save", error_code: "P2024", http_status: 400, attachments: 1, message_chars: 20 }));
    expect(lines[0]).not.toContain("secret question text");
  });

  it("never throws when the table write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const record = createPortalSendFailureRecorder({
      store: { create: async () => { throw new Error("database down"); } },
      log: () => undefined
    });
    await expect(record({ source: "server", stage: "thread_create" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("portal send failure persistence failed", expect.objectContaining({ stage: "thread_create" }));
    warn.mockRestore();
  });
});

describe("portalSendFailureMessageFields", () => {
  it("extracts the user's text and attachment names", () => {
    expect(portalSendFailureMessageFields({
      role: "user",
      content: [{ type: "text", text: "第一段" }, { type: "image", image: "x" }, { type: "text", text: "第二段" }],
      attachments: [{ name: "image.png", status: { type: "complete" } }, { status: { type: "complete" } }]
    })).toEqual({
      messagePreview: "第一段\n第二段",
      attachments: [{ name: "image.png", status: "complete" }]
    });
  });

  it("ignores assistant snapshots", () => {
    expect(portalSendFailureMessageFields({ role: "assistant", content: [{ type: "text", text: "hi" }] })).toEqual({});
  });
});

describe("PortalSendFailureRepository", () => {
  it("clips long fields and normalizes attachments on the way in and out", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const db: PortalSendFailureRepositoryDb = {
      portalSendFailure: {
        create: async ({ data }) => {
          const row = { id: `failure-${rows.length + 1}`, createdAt: new Date("2026-10-09T07:00:00Z"), ...data };
          rows.push(row);
          return row as never;
        },
        findMany: async ({ where }) => rows.filter((row) => row.threadId === where.threadId) as never
      }
    };
    const repository = new PortalSendFailureRepository(db);

    await repository.create({
      threadId: "thread-1",
      source: "client",
      stage: "attachment_upload",
      detail: "x".repeat(5000),
      attachments: [{ name: "a.pdf", failureCode: "network", sizeBytes: 12.6 }, { name: "" } as never]
    });

    const [record] = await repository.listForThread("thread-1");
    expect(record.detail?.length).toBe(4001);
    expect(record.attachments).toEqual([{ name: "a.pdf", failureCode: "network", sizeBytes: 13 }]);
    expect(record.createdAt).toBe("2026-10-09T07:00:00.000Z");
    expect(await repository.listForThread("thread-2")).toEqual([]);
  });
});
