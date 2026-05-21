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
  dingtalkNotificationEnabled: false,
  dingtalkNotificationManualRunsEnabled: false,
  dingtalkNotificationWebhookUrl: "",
  dingtalkNotificationRobotSecret: "",
  dingtalkNotificationFallbackUserIds: [],
  dingtalkNotificationTemplate: "",
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
    const dingtalkPayloads: Array<Record<string, unknown>> = [];
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
              assignee_id: 8001,
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
      if (url.includes("/api/v2/users/8001.json")) {
        return new Response(
          JSON.stringify({
            user: {
              id: 8001,
              name: "Assignee Agent",
              email: "assignee@example.com",
              role: "agent"
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
      if (url.startsWith("https://oapi.dingtalk.com/robot/send")) {
        dingtalkPayloads.push(JSON.parse(String(init?.body || "{}")));
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" }
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
        yield {
          type: "turn.completed",
          raw: {
            usage: {
              input_tokens: 1200,
              cached_input_tokens: 300,
              output_tokens: 180
            }
          }
        };
      })
    };
    const recordUsage = vi.fn(async (_input: unknown) => undefined);

    const settingsStore = {
      get: vi.fn(async () => ({
        ...baseSettings,
        zendeskBaseUrl: "https://example.zendesk.com",
        zendeskEmail: "agent@example.com",
        zendeskApiToken: "token",
        dingtalkNotificationEnabled: true,
        dingtalkNotificationManualRunsEnabled: true,
        dingtalkNotificationWebhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=robot-token",
        dingtalkNotificationFallbackUserIds: ["ding-fallback-1"]
      })),
      getForInstance: vi.fn(async () => ({
        ...baseSettings,
        zendeskBaseUrl: "https://example.zendesk.com",
        zendeskEmail: "agent@example.com",
        zendeskApiToken: "token",
        dingtalkNotificationEnabled: true,
        dingtalkNotificationManualRunsEnabled: true,
        dingtalkNotificationWebhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=robot-token",
        dingtalkNotificationFallbackUserIds: ["ding-fallback-1"]
      }))
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
          ticket: {
            requester?: { name?: string; email?: string };
            assignee?: { name?: string; email?: string };
          };
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
          codexRunConfig: {
            additionalDirectories: ["/tmp/knowledge/Docs"],
            enabledSkills: [
              {
                id: "managed:skill-support-triage",
                name: "support-ticket-triage",
                managedSkillId: "skill-support-triage",
                sourcePath: "/tmp/skills/support-ticket-triage"
              }
            ],
            _agentStudioSkillActivationPrompts: [
              {
                name: "support-ticket-triage",
                prompt: "Use the support ticket triage workflow before drafting a Zendesk action."
              }
            ]
          },
          enabledSkills: [
            {
              id: "managed:skill-support-triage",
              name: "support-ticket-triage",
              managedSkillId: "skill-support-triage",
              sourcePath: "/tmp/skills/support-ticket-triage",
              activationPrompt: "Use the support ticket triage workflow before drafting a Zendesk action."
            }
          ],
          knowledgeSets: [
            {
              id: "ks-docs",
              name: "Docs",
              path: "/tmp/knowledge/Docs",
              relativePath: ".agent-studio/knowledge-sets/Docs",
              manifestPath: ".agent-studio/knowledge-sets.md"
            }
          ]
        })),
        resolveDingTalkMentionTarget: vi.fn(async ({ zendeskUser }) => ({
          userIds: zendeskUser?.email === "assignee@example.com" ? ["ding-assignee-1"] : [],
          label: zendeskUser?.name,
          detail: "matched in test"
        })),
        conversationAudit,
        recordUsage
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
      expect(prompts[0]).toContain("Internal enabled skill activation hints for this run.");
      expect(prompts[0]).toContain("Use the support ticket triage workflow before drafting a Zendesk action.");
      expect(prompts[0]).toContain("Mounted knowledge sets are available.");
      expect(prompts[0]).toContain("mounted_knowledge_sets:");
      expect(prompts[0]).toContain("relative_path: .agent-studio/knowledge-sets/Docs");
      expect(prompts[0]).toContain('search_example: rg -n -i -L "<ticket keywords>" ".agent-studio/knowledge-sets/Docs"');
      expect(prompts[0]).toContain(
        "local_path: .zendesk/attachments/cache/example.zendesk.com/ticket-123/comment-101/att-7788-signal screenshot.png"
      );
      expect(prompts[1]).toContain("reason: 复用 ticket 附件缓存");
      expect(conversationAudit.beforeAgentRun.mock.calls[0]?.[0].context.ticket.requester).toMatchObject({
        name: "Ramen Support User",
        email: "requester@example.com"
      });
      expect(conversationAudit.beforeAgentRun.mock.calls[0]?.[0].context.ticket.assignee).toMatchObject({
        name: "Assignee Agent",
        email: "assignee@example.com"
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
      expect(recordUsage).toHaveBeenCalledTimes(2);
      expect(dingtalkPayloads).toHaveLength(2);
      expect(dingtalkPayloads[0]).toMatchObject({
        msgtype: "markdown",
        at: {
          atUserIds: ["ding-assignee-1"],
          isAtAll: false
        }
      });
      const firstDingTalkText = ((dingtalkPayloads[0].markdown as { text?: string } | undefined)?.text || "").trim();
      expect(firstDingTalkText).toContain("### Zendesk #123 - AI Update");
      expect(firstDingTalkText).toContain("**AI Note**");
      expect(firstDingTalkText).toContain("Attachment checked.");
      expect(firstDingTalkText).not.toContain("Public reply preview (not sent):");
      expect(firstDingTalkText).not.toContain("Agent Studio");
      expect(firstDingTalkText.endsWith("@Assignee Agent")).toBe(true);
      expect(recordUsage.mock.calls[0]?.[0]).toMatchObject({
        instanceId: "zendesk-1",
        ticketId: "123",
        runId: "run-1",
        auditThreadId: "audit-thread-1",
        externalConversationKey: "zendesk:zendesk-1:ticket:123:mode-1",
        runtime: {
          model: "gpt-5.5"
        },
        usage: {
          inputTokens: 1200,
          cachedInputTokens: 300,
          outputTokens: 180
        }
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
          expect.objectContaining({ kind: "source", title: "Mounted knowledge sets" }),
          expect.objectContaining({ kind: "source", title: "Enabled Codex skills" }),
          expect.objectContaining({ title: "Started Codex thread" }),
          expect.objectContaining({ title: "Resumed Codex thread" }),
          expect.objectContaining({ title: "Called agent" }),
          expect.objectContaining({ title: "Model reasoning summary" }),
          expect.objectContaining({ kind: "reasoning", title: "AI process summary" }),
          expect.objectContaining({ title: "Command execution completed" }),
          expect.objectContaining({ title: "Recorded usage telemetry" }),
          expect.objectContaining({ title: "Wrote Zendesk internal note" }),
          expect.objectContaining({ title: "Sent DingTalk notification" })
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

  it("processes missed call transcripts as forced internal notes", async () => {
    const prompts: string[] = [];
    const ticketUpdates: unknown[] = [];
    const runUpdates: Array<{ runId: string; patch: Record<string, unknown> }> = [];
    const bindingRecords = new Map<string, {
      ticketId: string;
      instanceId?: string;
      lastProcessedRequesterCommentId?: number;
      lastAction?: "public_reply" | "internal_note" | "handoff" | "skip" | "error";
      lastRunAt?: string;
      lastRunId?: string;
      createdAt: string;
      updatedAt: string;
    }>();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v2/tickets/45270.json") && init?.method !== "PUT") {
        return new Response(
          JSON.stringify({
            ticket: {
              id: 45270,
              subject: "Missed call from East_Texas_DSL",
              description: "Call from: +1 (936) 212-2907\nTime of call: May 20, 2026 at 4:12 PM UTC",
              status: "new",
              requester_id: 40908351238676,
              updated_at: "2026-05-20T16:13:50Z",
              tags: []
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/tickets/45270/comments.json")) {
        return new Response(
          JSON.stringify({
            comments: [
              {
                id: 49443304262036,
                author_id: -1,
                public: false,
                created_at: "2026-05-20T16:13:50Z",
                body: "#### **Call transcript:**\n\n**00:01** **Customer** My name is Joe Kelly with East Texas DSL. Please give me a callback.\n**00:24** **Customer** This is regarding the CloudCore charge."
              },
              {
                id: 49443288545556,
                author_id: 40908351238676,
                public: false,
                created_at: "2026-05-20T16:13:40Z",
                body: "Voicemail from +1 (936) 212-2907\nCall Details:\nListen to the recording: https://example.zendesk.com/recording"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/users/40908351238676.json")) {
        return new Response(
          JSON.stringify({
            user: {
              id: 40908351238676,
              name: "East_Texas_DSL",
              role: "end-user"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/tickets/45270.json") && init?.method === "PUT") {
        ticketUpdates.push(JSON.parse(String(init.body || "{}")));
        return new Response(JSON.stringify({ audit: { events: [{ id: 49443355555555, type: "Comment" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ detail: `unexpected request ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = {
      startThreadWithOptions: vi.fn(async () => ({ id: "codex-thread-voice" })),
      resumeThreadWithOptions: vi.fn(async () => ({ id: "codex-thread-voice" })),
      runStreamed: vi.fn(async function* (_thread: unknown, message: string) {
        prompts.push(message);
        yield {
          type: "message",
          text: JSON.stringify({
            decision: "public_reply",
            body: "We will call you back about the CloudCore charge.",
            publicReplyPreview: "We will call you back about the CloudCore charge.",
            internalNote: "Missed call transcript: caller requests a callback about a CloudCore charge.",
            processSummary: "Reviewed the missed call transcript and prepared an internal follow-up note.",
            confidence: 0.9,
            reasons: ["voice transcript"]
          })
        };
      })
    };

    const settingsStore = {
      get: vi.fn(async () => ({
        ...baseSettings,
        responseMode: "public_reply" as const,
        zendeskBaseUrl: "https://example.zendesk.com",
        zendeskEmail: "agent@example.com",
        zendeskApiToken: "token"
      })),
      getForInstance: vi.fn(async () => ({
        ...baseSettings,
        responseMode: "public_reply" as const,
        zendeskBaseUrl: "https://example.zendesk.com",
        zendeskEmail: "agent@example.com",
        zendeskApiToken: "token"
      }))
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
      create: vi.fn(async () => ({
        id: "run-voice-1",
        instanceId: "zendesk-1",
        ticketId: "45270",
        source: "manual",
        status: "received",
        detail: "手动触发处理中",
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
      beforeAgentRun: vi.fn(async () => ({
        threadId: "audit-thread-voice",
        userMessageId: "audit-user-voice",
        externalConversationKey: "zendesk:zendesk-1:ticket:45270:mode-1"
      })),
      afterAgentRun: vi.fn(async (_input: unknown) => undefined)
    };

    const service = new ZendeskIntegrationService(
      {
        resolveAgentRuntime: vi.fn(async () => ({
          runtime: runtime as never,
          model: "gpt-5.5",
          reasoningEffort: "high" as const,
          workspace: "/tmp/zendesk-voice",
          codexRunConfig: {}
        })),
        conversationAudit
      },
      settingsStore as never,
      bindingStore as unknown as ZendeskBindingStore,
      runStore as unknown as ZendeskRunStore
    );

    const result = await service.runTicket("45270", "zendesk-1");

    expect(result).toMatchObject({
      status: "noted",
      requesterCommentId: 49443304262036
    });
    expect(prompts[0]).toContain("input_kind: voice_transcript");
    expect(prompts[0]).toContain("This ticket was triggered by a missed call, voicemail, or call transcript.");
    expect(ticketUpdates).toHaveLength(1);
    expect(ticketUpdates[0]).toMatchObject({
      ticket: {
        comment: {
          public: false
        }
      }
    });
    expect(runUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patch: expect.objectContaining({
            detail: "语音转写工单已强制记录为内部备注",
            status: "noted",
            requesterCommentId: 49443304262036
          })
        })
      ])
    );
    const allProcessRows = conversationAudit.afterAgentRun.mock.calls.flatMap((call) => {
      const value = call[0] as { processRows?: Array<{ title?: string; detail?: string }> };
      return value.processRows ?? [];
    });
    expect(allProcessRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Selected voice transcript",
          detail: expect.stringContaining("forced_action: internal_note")
        })
      ])
    );
  });
});
