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
  attachmentTypeRestrictionEnabled: true,
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
        const firstRequesterComment = {
          id: 101,
          author_id: 9001,
          body: "Please check the screenshot.",
          public: true,
          created_at: "2026-05-20T02:01:00Z",
          attachments: [
            {
              id: 7788,
              file_name: "signal screenshot.png",
              content_type: "image/png",
              size: 7,
              content_url: "https://example.zendesk.com/attachments/token/signal.png",
              inline: true
            }
          ]
        };
        const comments =
          nextRequesterCommentId === 101
            ? [firstRequesterComment]
            : [
                {
                  id: 102,
                  author_id: 9001,
                  body: "Any update?",
                  public: true,
                  created_at: "2026-05-20T02:03:00Z",
                  attachments: []
                },
                firstRequesterComment
              ];
        return new Response(
          JSON.stringify({
            comments
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/users/9001.json")) {
        return new Response(
          JSON.stringify({
            user: {
              id: 9001,
              name: "Ramen Support User",
              email: "requester@example.com",
              role: "end-user"
            }
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
          type: "item.completed",
          raw: {
            item: {
              id: "reasoning-1",
              type: "reasoning",
              text: "Checked the Zendesk ticket context and reviewed the available attachment metadata."
            }
          }
        };
        yield {
          type: "item.completed",
          raw: {
            item: {
              id: "cmd-1",
              type: "command_execution",
              command: "ls .zendesk/attachments",
              aggregated_output: "run-run-1",
              status: "completed",
              exit_code: 0
            }
          }
        };
        yield {
          type: "message",
          text: JSON.stringify({
            decision: "internal_note",
            body: "",
            publicReplyPreview: "We are reviewing the screenshot and will confirm the next configuration step.",
            internalNote: "Attachment checked.",
            processSummary: "Reviewed the requester comment, inspected the downloaded screenshot attachment, and selected an internal note because a public reply needs support verification.",
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
    const conversationAudit = {
      beforeAgentRun: vi.fn(async (input: {
        context: {
          ticket: { requester?: { name?: string; email?: string } };
          comments: Array<{ attachments: Array<{ relativePath?: string }> }>;
        };
        runId: string;
      }) => ({
        threadId: "audit-thread-1",
        userMessageId: `audit-user-${input.runId}`,
        externalConversationKey: "zendesk:zendesk-1:ticket:123:mode-1"
      })),
      afterAgentRun: vi.fn(async (_input: unknown) => undefined)
    };

    const service = new ZendeskIntegrationService(
      {
        resolveAgentRuntime: vi.fn(async () => ({
          runtime: runtime as never,
          model: "gpt-5.5",
          reasoningEffort: "high" as const,
          workspace: tempRoot,
          codexRunConfig: {}
        })),
        conversationAudit
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
      expect(prompts[0]).toContain("requester_email: requester@example.com");
      expect(prompts[0]).toContain(
        "local_path: .zendesk/attachments/cache/example.zendesk.com/ticket-123/comment-101/att-7788-signal screenshot.png"
      );
      expect(prompts[1]).toContain("reason: 复用 ticket 附件缓存");
      expect(conversationAudit.beforeAgentRun.mock.calls[0]?.[0].context.ticket.requester).toMatchObject({
        name: "Ramen Support User",
        email: "requester@example.com"
      });
      expect(conversationAudit.beforeAgentRun.mock.calls[0]?.[0].context.comments[0]?.attachments[0]?.relativePath).toBe(
        ".zendesk/attachments/cache/example.zendesk.com/ticket-123/comment-101/att-7788-signal screenshot.png"
      );
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === "https://example.zendesk.com/attachments/token/signal.png")
      ).toHaveLength(1);
      expect(conversationAudit.afterAgentRun.mock.calls[0]?.[0]).toMatchObject({
        audit: {
          threadId: "audit-thread-1",
          externalConversationKey: "zendesk:zendesk-1:ticket:123:mode-1"
        },
        decision: {
          decision: "internal_note"
        },
        codexThreadId: "codex-thread-1"
      });
      const firstAuditAfterRun = conversationAudit.afterAgentRun.mock.calls[0]?.[0] as
        | { action?: { body?: string } }
        | undefined;
      expect(firstAuditAfterRun?.action?.body).toContain("Public reply preview (not sent):");
      const allProcessRows = conversationAudit.afterAgentRun.mock.calls.flatMap((call) => {
        const value = call[0] as { processRows?: Array<{ title?: string }> };
        return value.processRows ?? [];
      });
      expect(allProcessRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "Read Zendesk ticket" }),
          expect.objectContaining({ title: "Prepared Zendesk attachments" }),
          expect.objectContaining({ title: "Started Codex thread" }),
          expect.objectContaining({ title: "Resumed Codex thread" }),
          expect.objectContaining({ title: "Called agent" }),
          expect.objectContaining({ title: "Model reasoning summary" }),
          expect.objectContaining({ kind: "reasoning", title: "AI process summary" }),
          expect.objectContaining({ title: "Command execution completed" }),
          expect.objectContaining({ title: "Wrote Zendesk internal note" })
        ])
      );
      await expect(
        fs.stat(
          path.join(
            tempRoot,
            ".zendesk",
            "attachments",
            "cache",
            "example.zendesk.com",
            "ticket-123",
            "comment-101",
            "att-7788-signal screenshot.png"
          )
        )
      ).resolves.toBeTruthy();
      expect(runUpdates.some((item) => item.patch.status === "noted")).toBe(true);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
