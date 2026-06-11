import { afterEach, describe, expect, it, vi } from "vitest";

import { ZendeskClient } from "./client.js";
import type { ZendeskIntegrationSettings } from "./types.js";

const settings: ZendeskIntegrationSettings = {
  enabled: true,
  publicBaseUrl: "https://agent.example.com",
  zendeskBaseUrl: "https://example.zendesk.com",
  zendeskEmail: "agent@example.com",
  zendeskApiToken: "token",
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
  dingtalkNotificationGroupFallbacks: [],
  dingtalkNotificationTemplate: "",
  dingtalkReviewRequiredEnabled: false,
  dingtalkReviewDueHours: 24,
  aiReviewEmailReminderEnabled: false,
  aiReviewEmailReminderTime: "09:00",
  aiReviewEmailReminderTimezone: "Asia/Shanghai",
  aiReviewEmailReminderCcEmails: [],
  systemPrompt: "Return JSON."
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ZendeskClient", () => {
  it("attaches author identities to recent ticket comments", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v2/tickets/555.json")) {
        return new Response(
          JSON.stringify({
            ticket: {
              id: 555,
              subject: "Customer replied through CC",
              description: "Original requester opened the ticket.",
              status: "open",
              requester_id: 100,
              assignee_id: 200,
              tags: []
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/tickets/555/comments.json")) {
        return new Response(
          JSON.stringify({
            comments: [
              {
                id: 503,
                author_id: 300,
                body: "I am the actual customer replying from CC.",
                public: true,
                created_at: "2026-05-22T12:38:39Z",
                attachments: []
              },
              {
                id: 502,
                author_id: 200,
                body: "Please provide more information.",
                public: true,
                created_at: "2026-05-22T12:00:00Z",
                attachments: []
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/users/100.json")) {
        return new Response(
          JSON.stringify({
            user: {
              id: 100,
              name: "Original Requester",
              email: "requester@example.com",
              role: "end-user"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/users/200.json")) {
        return new Response(
          JSON.stringify({
            user: {
              id: 200,
              name: "Support Agent",
              email: "agent@example.com",
              role: "agent"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/users/300.json")) {
        return new Response(
          JSON.stringify({
            user: {
              id: 300,
              name: "Actual Customer",
              email: "customer@example.com",
              role: "end-user"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ detail: `unexpected request ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = await new ZendeskClient(settings).getTicketContext("555", 12);

    expect(context.comments[0]).toMatchObject({
      id: 503,
      author: {
        id: 300,
        name: "Actual Customer",
        email: "customer@example.com",
        role: "end-user"
      }
    });
    expect(context.comments[1]).toMatchObject({
      id: 502,
      author: {
        id: 200,
        name: "Support Agent",
        role: "agent"
      }
    });
  });
});
