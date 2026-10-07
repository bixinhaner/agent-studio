import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatClusterView,
  FORWARDED_BY_HEADER,
  fetchChatPeerStatus,
  parseChatPeerStatus,
  peerOwnsRun,
  peerUrlsExcludingSelf,
  type ChatPeerStatus
} from "./cluster.js";
import { createChatClusterRoutingMiddleware, inFlightForwardCount, resolveChatRunKey } from "./forwarding.js";
import { ChatRetirementController } from "./retirement.js";

const servers: http.Server[] = [];

async function listen(app: express.Express | http.RequestListener): Promise<string> {
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function closedPortUrl(): Promise<string> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  })));
});

function peerStatus(input: Partial<ChatPeerStatus> & { url: string }): ChatPeerStatus {
  return {
    state: "up",
    ready: true,
    draining: false,
    busyCount: 0,
    activeThreads: [],
    turns: [],
    ...input
  };
}

describe("chat cluster peers", () => {
  it("excludes its own loopback URL from the peer list", () => {
    expect(peerUrlsExcludingSelf(
      ["http://127.0.0.1:8791", "http://127.0.0.1:8792", "http://localhost:8791", "not a url"],
      8791
    )).toEqual(["http://127.0.0.1:8792"]);
  });

  it("finds run owners from slot-aware and legacy status payloads", () => {
    const current = parseChatPeerStatus("http://127.0.0.1:8792", {
      instance_id: "chat-b:1",
      ready: false,
      draining: true,
      busy_count: 2,
      owned_runs: { portal_session: ["s-1"], crest_run: ["c-1"], action_connector_run: ["r-1"] }
    });
    expect(current).toMatchObject({ instanceId: "chat-b:1", ready: false, draining: true, busyCount: 2 });
    expect(peerOwnsRun(current, { kind: "portal_session", id: "s-1" })).toBe(true);
    expect(peerOwnsRun(current, { kind: "crest_run", id: "c-1" })).toBe(true);
    expect(peerOwnsRun(current, { kind: "action_connector_run", id: "r-1" })).toBe(true);
    expect(peerOwnsRun(current, { kind: "portal_session", id: "s-2" })).toBe(false);

    // The release before blue-green only reports runtime turns.
    const legacy = parseChatPeerStatus("http://127.0.0.1:8791", {
      draining: false,
      active_runtime_turns: 1,
      turns: [{ session_id: "legacy-session", thread_id: "t-1" }],
      active_threads: [{ thread_id: "t-1" }]
    });
    expect(legacy).toMatchObject({ instanceId: undefined, ready: false, busyCount: 2 });
    expect(peerOwnsRun(legacy, { kind: "portal_session", id: "legacy-session" })).toBe(true);
    expect(peerOwnsRun(legacy, { kind: "crest_run", id: "legacy-session" })).toBe(false);
  });

  it("treats a stopped slot as owning nothing and a failing one as unknown", async () => {
    expect((await fetchChatPeerStatus(await closedPortUrl())).state).toBe("down");
    const failing = await listen((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.statusCode = 500;
      res.end("boom");
    });
    expect((await fetchChatPeerStatus(failing)).state).toBe("unknown");
  });

  it("only offers a slot-aware, non-draining peer for new work", async () => {
    const statuses = [
      peerStatus({ url: "http://legacy", ready: false }),
      peerStatus({ url: "http://draining", draining: true }),
      peerStatus({ url: "http://ready" })
    ];
    const cluster = new ChatClusterView({ peerUrls: [], selfPort: 1 });
    vi.spyOn(cluster, "statuses").mockResolvedValue(statuses);
    expect((await cluster.readyPeer(0))?.url).toBe("http://ready");
  });
});

describe("chat cluster forwarding", () => {
  async function startPeer() {
    const seen: Array<{ method: string; url: string; host?: string; forwardedBy?: string; cookie?: string; body: unknown }> = [];
    const peer = express();
    peer.use(express.json());
    peer.post("/api/chat/cancel", (req, res) => {
      seen.push({
        method: req.method,
        url: req.originalUrl,
        host: req.header("host"),
        forwardedBy: req.header(FORWARDED_BY_HEADER),
        cookie: req.header("cookie"),
        body: req.body
      });
      res.status(202).json({ cancelled: true, by: "peer" });
    });
    peer.post("/api/chat/stream", (_req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.flushHeaders();
      res.write("event: delta\ndata: {\"n\":1}\n\n");
      setTimeout(() => {
        res.write("event: done\ndata: {}\n\n");
        res.end();
      }, 30);
    });
    peer.get("/api/threads", (req, res) => {
      seen.push({ method: req.method, url: req.originalUrl, forwardedBy: req.header(FORWARDED_BY_HEADER), body: undefined });
      res.json({ threads: [], by: "peer" });
    });
    const url = await listen(peer);
    return { url, seen };
  }

  async function startLocal(input: {
    cluster: ChatClusterView;
    ownsLocally?: boolean;
    retiring?: boolean;
  }) {
    const local = express();
    local.use(express.json());
    local.use(createChatClusterRoutingMiddleware({
      cluster: input.cluster,
      instanceId: "chat-a:test",
      resolveRunKey: resolveChatRunKey,
      ownsLocally: () => input.ownsLocally === true,
      isRetiring: () => input.retiring === true
    }));
    local.post("/api/chat/cancel", (_req, res) => res.json({ cancelled: false, by: "local" }));
    local.post("/api/chat/stream", (_req, res) => res.json({ by: "local" }));
    local.get("/api/threads", (_req, res) => res.json({ by: "local" }));
    return listen(local);
  }

  function clusterFor(peerUrl: string, statuses: ChatPeerStatus[]) {
    const cluster = new ChatClusterView({ peerUrls: [peerUrl], selfPort: 1 });
    vi.spyOn(cluster, "statuses").mockResolvedValue(statuses);
    return cluster;
  }

  it("relays run requests to the owning peer with the caller's host, cookies and body", async () => {
    const peer = await startPeer();
    const cluster = clusterFor(peer.url, [peerStatus({
      url: peer.url,
      ready: false,
      draining: true,
      ownedRuns: { portal_session: ["s-1"], crest_run: [], action_connector_run: [] }
    })]);
    const local = await startLocal({ cluster });

    const response = await fetch(`${local}/api/chat/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "sid=abc", "X-Test-Host": "brand" },
      body: JSON.stringify({ session_id: "s-1", thread_id: "t-1" })
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ cancelled: true, by: "peer" });
    expect(peer.seen).toEqual([expect.objectContaining({
      url: "/api/chat/cancel",
      forwardedBy: "chat-a:test",
      cookie: "sid=abc",
      body: { session_id: "s-1", thread_id: "t-1" },
      host: new URL(local).host
    })]);
    expect(inFlightForwardCount()).toBe(0);
  });

  it("handles run requests locally when it owns the run or nobody does", async () => {
    const peer = await startPeer();
    const cluster = clusterFor(peer.url, [peerStatus({ url: peer.url, ownedRuns: { portal_session: [], crest_run: [], action_connector_run: [] } })]);
    const ownsLocal = await startLocal({ cluster, ownsLocally: true });
    const nobody = await startLocal({ cluster });
    for (const base of [ownsLocal, nobody]) {
      const response = await fetch(`${base}/api/chat/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: "s-1" })
      });
      expect(await response.json()).toEqual({ cancelled: false, by: "local" });
    }
    expect(peer.seen).toHaveLength(0);
  });

  it("hands every new request to the ready peer while retiring, streaming SSE through", async () => {
    const peer = await startPeer();
    const cluster = clusterFor(peer.url, [peerStatus({ url: peer.url })]);
    const retiring = await startLocal({ cluster, retiring: true });

    const list = await fetch(`${retiring}/api/threads?limit=5`);
    expect(await list.json()).toEqual({ threads: [], by: "peer" });
    expect(peer.seen[0]).toMatchObject({ url: "/api/threads?limit=5", forwardedBy: "chat-a:test" });

    const stream = await fetch(`${retiring}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" })
    });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(await stream.text()).toBe("event: delta\ndata: {\"n\":1}\n\nevent: done\ndata: {}\n\n");
  });

  it("never relays a request twice and keeps serving when no peer is ready", async () => {
    const peer = await startPeer();
    const cluster = clusterFor(peer.url, [peerStatus({ url: peer.url, ready: false })]);
    const retiring = await startLocal({ cluster, retiring: true });
    expect(await (await fetch(`${retiring}/api/threads`)).json()).toEqual({ by: "local" });

    const readyCluster = clusterFor(peer.url, [peerStatus({ url: peer.url })]);
    const second = await startLocal({ cluster: readyCluster, retiring: true });
    const relayed = await fetch(`${second}/api/threads`, { headers: { [FORWARDED_BY_HEADER]: "chat-b:test" } });
    expect(await relayed.json()).toEqual({ by: "local" });
    expect(peer.seen).toHaveLength(0);
  });

  it("returns a retryable 502 when the peer disappears mid-handover", async () => {
    const gone = await closedPortUrl();
    const cluster = clusterFor(gone, [peerStatus({ url: gone })]);
    const retiring = await startLocal({ cluster, retiring: true });
    const response = await fetch(`${retiring}/api/threads`);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "CHAT_FORWARD_FAILED" });
  });

  it("keys each channel's run operations by the identifier that channel uses", () => {
    const req = (method: string, path: string, body?: unknown) => ({ method, path, body }) as express.Request;
    expect(resolveChatRunKey(req("POST", "/api/chat/steer", { session_id: "s" }))).toEqual({ kind: "portal_session", id: "s" });
    expect(resolveChatRunKey(req("POST", "/api/integrations/crest/chat/cancel", { clientRunId: "c" }))).toEqual({ kind: "crest_run", id: "c" });
    expect(resolveChatRunKey(req("POST", "/api/integrations/action-connectors/conn/runs/r%201/cancel"))).toEqual({
      kind: "action_connector_run",
      id: "r 1"
    });
    expect(resolveChatRunKey(req("POST", "/api/action-connectors/conn/tool-results", { runId: "r" }))).toEqual({
      kind: "action_connector_run",
      id: "r"
    });
    expect(resolveChatRunKey(req("POST", "/api/chat/stream", { session_id: "s" }))).toEqual({ kind: "portal_session", id: "s" });
    expect(resolveChatRunKey(req("POST", "/api/chat/stream", {}))).toBeUndefined();
    expect(resolveChatRunKey(req("POST", "/api/action-connectors/conn/assistant-runs/a1/cancel"))).toEqual({
      kind: "action_connector_run",
      id: "a1"
    });
    expect(resolveChatRunKey(req("POST", "/api/action-connectors/conn/proactive/runs/p1/cancel"))).toEqual({
      kind: "action_connector_run",
      id: "p1"
    });
    expect(resolveChatRunKey(req("GET", "/api/chat/cancel"))).toBeUndefined();
  });
});

describe("chat retirement", () => {
  function controller(input: {
    drain?: string;
    peerReady?: boolean;
    busy?: number;
    maxMs?: number;
    onRetiringPoll?: () => void | Promise<void>;
  }) {
    const state = { drain: input.drain, peerReady: input.peerReady ?? true, busy: input.busy ?? 0, now: 0 };
    const cluster = new ChatClusterView({ peerUrls: [], selfPort: 1 });
    vi.spyOn(cluster, "readyPeer").mockImplementation(async () =>
      state.peerReady ? peerStatus({ url: "http://peer" }) : undefined
    );
    const events: string[] = [];
    const retirement = new ChatRetirementController({
      cluster,
      readDrainReason: async () => state.drain,
      busyCount: () => state.busy,
      retireMaxMs: input.maxMs ?? 60_000,
      onRetireStart: () => {
        events.push("start");
      },
      onRetireCancel: () => {
        events.push("cancel");
      },
      onRetiringPoll: input.onRetiringPoll,
      exit: async ({ interruptRemaining }) => {
        events.push(interruptRemaining ? "exit:interrupt" : "exit:idle");
      },
      now: () => state.now
    });
    return { retirement, state, events };
  }

  it("keeps a lone drained instance serving with the drain message and never exits", async () => {
    const { retirement, events } = controller({ drain: "updating", peerReady: false });
    await retirement.poll();
    await retirement.poll();
    expect(retirement.isRetiring()).toBe(false);
    expect(retirement.isReady()).toBe(true);
    expect(retirement.userFacingDrainReason()).toBe("updating");
    expect(events).toEqual([]);
  });

  it("hands over to a ready peer, finishes in-flight work, then exits", async () => {
    const { retirement, state, events } = controller({ drain: "updating", busy: 1 });
    await retirement.poll();
    expect(retirement.isRetiring()).toBe(true);
    expect(retirement.isReady()).toBe(false);
    expect(retirement.userFacingDrainReason()).toBeUndefined();
    expect(retirement.claimBlockReason()).toBe("updating");
    expect(events).toEqual(["start"]);

    state.busy = 0;
    await retirement.poll();
    expect(events).toEqual(["start"]);
    await retirement.poll();
    expect(events).toEqual(["start", "exit:idle"]);
  });

  it("runs the retiring hook on every retiring poll and still exits when it fails", async () => {
    let calls = 0;
    const { retirement, state, events } = controller({
      drain: "updating",
      busy: 1,
      onRetiringPoll: () => {
        calls += 1;
        if (calls === 2) throw new Error("release failed");
      }
    });
    await retirement.poll();
    expect(calls).toBe(1);
    state.busy = 0;
    await retirement.poll();
    await retirement.poll();
    expect(calls).toBe(3);
    expect(events).toEqual(["start", "exit:idle"]);
  });

  it("interrupts work still running at the retirement limit", async () => {
    const { retirement, state, events } = controller({ drain: "updating", busy: 3, maxMs: 1_000 });
    await retirement.poll();
    state.now = 999;
    await retirement.poll();
    expect(events).toEqual(["start"]);
    state.now = 1_000;
    await retirement.poll();
    expect(events).toEqual(["start", "exit:interrupt"]);
  });

  it("takes traffic back when the new slot goes away or the deploy removes the drain", async () => {
    const lost = controller({ drain: "updating", busy: 1 });
    await lost.retirement.poll();
    lost.state.peerReady = false;
    await lost.retirement.poll();
    await lost.retirement.poll();
    expect(lost.retirement.isRetiring()).toBe(true);
    await lost.retirement.poll();
    expect(lost.retirement.isRetiring()).toBe(false);
    expect(lost.events).toEqual(["start", "cancel"]);

    const aborted = controller({ drain: "updating", busy: 1 });
    await aborted.retirement.poll();
    aborted.state.drain = undefined;
    await aborted.retirement.poll();
    expect(aborted.retirement.isReady()).toBe(true);
    expect(aborted.events).toEqual(["start", "cancel"]);
  });
});
