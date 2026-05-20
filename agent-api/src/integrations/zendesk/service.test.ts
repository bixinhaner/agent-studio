import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZendeskBindingStore } from "./binding-store.js";
import { ZendeskRunStore } from "./run-store.js";
import { ZendeskIntegrationService } from "./service.js";
import { findZendeskReadinessGaps } from "./settings-store.js";
import type { ZendeskIntegrationSettings } from "./types.js";

const baseSettings: ZendeskIntegrationSettings = {
  enabled: true,
  publicBaseUrl: "https://agent.example.com",
  zendeskBaseUrl: "",
  zendeskEmail: "",
  zendeskApiToken: "",
  webhookSigningSecret: "secret",
  responseMode: "internal_note",
  fallbackMode: "internal_note",
  autoStatus: "pending",
  excludedTags: [],
  agentModeId: "mode-1",
  knowledgeSetIds: [],
  workspace: "/tmp",
  model: "gpt-5.5",
  reasoningEffort: "high",
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled",
  additionalDirectories: [],
  maxCommentHistory: 12,
  attachmentReadingEnabled: true,
  maxAttachmentCount: 5,
  maxAttachmentBytes: 10 * 1024 * 1024,
  allowedAttachmentMimeTypes: ["image/*", "application/pdf", "text/*"],
  systemPrompt: "Return JSON."
};

function signBody(body: string, timestamp: string, secret: string) {
  return createHmac("sha256", secret).update(`${timestamp}${body}`).digest("base64");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ZendeskIntegrationService", () => {
  it("requires an Agent Mode binding for production readiness", () => {
    expect(findZendeskReadinessGaps({ ...baseSettings, agentModeId: "" })).toContain("agent_mode_id");
    expect(findZendeskReadinessGaps(baseSettings)).not.toContain("agent_mode_id");
    expect(findZendeskReadinessGaps({ ...baseSettings, workspace: "", model: "" })).not.toContain("workspace");
    expect(findZendeskReadinessGaps({ ...baseSettings, workspace: "", model: "" })).not.toContain("model");
  });

  it("accepts instance-scoped webhooks and returns before the background run finishes", async () => {
    const body = JSON.stringify({ ticket_id: "123" });
    const timestamp = new Date().toISOString();
    const settingsStore = {
      get: vi.fn(async () => {
        throw new Error("legacy settings should not be used");
      }),
      getForInstance: vi.fn(async () => baseSettings)
    };
    const bindingStore = {
      upsert: vi.fn(async () => ({
        ticketId: "123",
        instanceId: "zendesk-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
    };
    const runStore = {
      create: vi.fn(async () => ({
        id: "run-1",
        instanceId: "zendesk-1",
        ticketId: "123",
        source: "webhook" as const,
        status: "received" as const,
        detail: "received",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })),
      update: vi.fn(async () => undefined),
      listForInstance: vi.fn(async () => [])
    };

    const service = new ZendeskIntegrationService(
      {},
      settingsStore as never,
      bindingStore as unknown as ZendeskBindingStore,
      runStore as unknown as ZendeskRunStore
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await service.handleWebhook(
        body,
        {
          "x-zendesk-webhook-signature-timestamp": timestamp,
          "x-zendesk-webhook-signature": signBody(body, timestamp, baseSettings.webhookSigningSecret)
        },
        "zendesk-1"
      );

      expect(settingsStore.getForInstance).toHaveBeenCalledWith("zendesk-1");
      expect(runStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: "zendesk-1",
          ticketId: "123",
          source: "webhook",
          status: "received"
        })
      );
      expect(result.result).toMatchObject({
        status: "received",
        runId: "run-1"
      });
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 0));
      consoleError.mockRestore();
    }
  });

  it("reuses one Codex thread per Zendesk ticket and passes downloaded attachments into the prompt", async () => {
    const tempRoot = path.resolve(process.cwd(), "..", "temp", `zendesk-thread-${Date.now()}`);
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    const bindingRecords = new Map<string, {
      ticketId: string;
      instanceId?: string;
      lastProcessedRequesterCommentId?: number;
      lastAction?: "public_reply" | "internal_note" | "handoff" | "skip" | "error";
      lastRunAt?: string;
      lastRunId?: string;
      codexThreadId?: string;
      workspacePath?: string;
      createdAt: string;
      updatedAt: string;
    }>();
    const runUpdates: Array<{ runId: string; patch: Record<string, unknown> }> = [];
    const prompts: string[] = [];
    let nextRequesterCommentId = 101;
    let runCounter = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v2/tickets/123.json") && init?.method !== "PUT") {
        return new Response(
          JSON.stringify({
            ticket: {
              id: 123,
              subject: "CPE offline",
              description: "Customer says the CPE is offline.",
              status: "open",
              priority: "normal",
              requester_id: 9001,
              updated_at: "2026-05-20T02:00:00Z",
              tags: []
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/tickets/123/comments.json")) {
        return new Response(
          JSON.stringify({
            comments: [
              {
                id: nextRequesterCommentId,
                author_id: 9001,
                body: nextRequesterCommentId === 101 ? "Please check the screenshot." : "Any update?",
                public: true,
                created_at: "2026-05-20T02:01:00Z",
                attachments:
                  nextRequesterCommentId === 101
                    ? [
                        {
                          id: 7788,
                          file_name: "signal screenshot.png",
                          content_type: "image/png",
                          size: 7,
                          content_url: "https://example.zendesk.com/attachments/token/signal.png",
                          inline: true
                        }
                      ]
                    : []
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "https://example.zendesk.com/attachments/token/signal.png") {
        return new Response("pngdata", {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": "7"
          }
        });
      }
      if (url.includes("/api/v2/tickets/123.json") && init?.method === "PUT") {
        return new Response(JSON.stringify({ audit: { events: [{ id: 9000000000001, type: "Comment" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ detail: `unexpected request ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = {
      startThreadWithOptions: vi.fn(async () => ({ id: "codex-thread-1" })),
      resumeThreadWithOptions: vi.fn(async () => ({ id: "codex-thread-1" })),
      runStreamed: vi.fn(async function* (_thread: unknown, message: string) {
        prompts.push(message);
        yield {
          type: "message",
          text: JSON.stringify({
            decision: "internal_note",
            body: "",
            internalNote: "Attachment checked.",
            confidence: 0.8,
            reasons: ["test"]
          })
        };
      })
    };

    const settingsStore = {
      get: vi.fn(async () => ({ ...baseSettings, zendeskBaseUrl: "https://example.zendesk.com", zendeskEmail: "agent@example.com", zendeskApiToken: "token" })),
      getForInstance: vi.fn(async () => ({ ...baseSettings, zendeskBaseUrl: "https://example.zendesk.com", zendeskEmail: "agent@example.com", zendeskApiToken: "token" }))
    };
    const bindingStore = {
      get: vi.fn(async (ticketId: string, instanceId?: string) => bindingRecords.get(`${instanceId || "legacy"}:${ticketId}`)),
      upsert: vi.fn(async (ticketId: string, patch: Record<string, unknown>, instanceId?: string) => {
        const key = `${instanceId || "legacy"}:${ticketId}`;
        const now = new Date().toISOString();
        const current =
          bindingRecords.get(key) ??
          {
            ticketId,
            instanceId,
            createdAt: now,
            updatedAt: now
          };
        const next = {
          ...current,
          ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
          updatedAt: now
        };
        bindingRecords.set(key, next as typeof current);
        return next;
      })
    };
    const runStore = {
      create: vi.fn(async (input: { ticketId: string; source: "manual" | "webhook"; instanceId?: string; status: string; detail: string }) => ({
        id: `run-${++runCounter}`,
        instanceId: input.instanceId,
        ticketId: input.ticketId,
        source: input.source,
        status: input.status,
        detail: input.detail,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })),
      update: vi.fn(async (runId: string, patch: Record<string, unknown>) => {
        runUpdates.push({ runId, patch });
        return undefined;
      }),
      listForInstance: vi.fn(async () => [])
    };

    const service = new ZendeskIntegrationService(
      {
        resolveAgentRuntime: vi.fn(async () => ({
          runtime: runtime as never,
          model: "gpt-5.5",
          reasoningEffort: "high" as const,
          workspace: tempRoot,
          codexRunConfig: {}
        }))
      },
      settingsStore as never,
      bindingStore as unknown as ZendeskBindingStore,
      runStore as unknown as ZendeskRunStore
    );

    try {
      await service.runTicket("123", "zendesk-1");
      nextRequesterCommentId = 102;
      await service.runTicket("123", "zendesk-1");

      expect(runtime.startThreadWithOptions).toHaveBeenCalledTimes(1);
      expect(runtime.resumeThreadWithOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "codex-thread-1",
          workspace: tempRoot
        })
      );
      expect(bindingRecords.get("zendesk-1:123")).toMatchObject({
        codexThreadId: "codex-thread-1",
        workspacePath: tempRoot,
        lastProcessedRequesterCommentId: 102
      });
      expect(prompts[0]).toContain("attachments:");
      expect(prompts[0]).toContain("local_path: .zendesk/attachments/run-run-1/comment-101/01-signal screenshot.png");
      await expect(
        fs.stat(path.join(tempRoot, ".zendesk", "attachments", "run-run-1", "comment-101", "01-signal screenshot.png"))
      ).resolves.toBeTruthy();
      expect(runUpdates.some((item) => item.patch.status === "noted")).toBe(true);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
