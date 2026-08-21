import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createDwsRouter, issueDwsProxyTokenLease } from "./dws-router.js";

describe("DWS runtime router", () => {
  it("executes only within the user and workspace bound to the short-lived lease", async () => {
    const execute = vi.fn(async (input: {
      onOutput: (event: { stream: "stdout" | "stderr"; data: string }) => void;
    }) => {
      input.onOutput({ stream: "stdout", data: "ok\n" });
      return 0;
    });
    const app = express();
    app.use(express.json());
    app.use("/dws", createDwsRouter({
      executor: { execute } as never,
      resolveIdentity: async (userId) => ({
        agentStudioUserId: userId,
        dingtalkCorpId: "ding-corp",
        dingtalkUserId: "ding-user"
      })
    }));
    const lease = issueDwsProxyTokenLease({
      userId: "agent-user",
      workspacePath: "/srv/workspaces/thread-1"
    });

    const response = await request(app)
      .post("/dws/exec")
      .set("Authorization", `Bearer ${lease.token}`)
      .send({ args: ["chat", "+dm", "--to", "张三", "--content", "你好"] });

    expect(response.status).toBe(200);
    expect(response.text).toContain('{"stream":"stdout","data":"ok\\n"}');
    expect(response.text).toContain('{"stream":"exit","code":0}');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: "/srv/workspaces/thread-1",
      args: ["chat", "+dm", "--to", "张三", "--content", "你好"],
      identity: expect.objectContaining({ agentStudioUserId: "agent-user" })
    }));
  });

  it("rejects missing and expired runtime leases", async () => {
    const app = express();
    app.use(express.json());
    app.use("/dws", createDwsRouter({
      executor: { execute: vi.fn() } as never,
      resolveIdentity: async () => undefined
    }));
    const expired = issueDwsProxyTokenLease({ userId: "agent-user", workspacePath: "/srv/workspace" }, -1);

    expect((await request(app).post("/dws/exec").send({ args: ["version"] })).status).toBe(401);
    expect(
      (await request(app).post("/dws/exec").set("Authorization", `Bearer ${expired.token}`).send({ args: ["version"] }))
        .status
    ).toBe(401);
  });
});
