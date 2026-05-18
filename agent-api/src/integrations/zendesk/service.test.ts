import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { ZendeskBindingStore } from "./binding-store.js";
import { ZendeskRunStore } from "./run-store.js";
import { ZendeskIntegrationService } from "./service.js";
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
  workspace: "/tmp",
  model: "gpt-5.5",
  reasoningEffort: "high",
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled",
  additionalDirectories: [],
  maxCommentHistory: 12,
  systemPrompt: "Return JSON."
};

function signBody(body: string, timestamp: string, secret: string) {
  return createHmac("sha256", secret).update(`${timestamp}${body}`).digest("base64");
}

describe("ZendeskIntegrationService", () => {
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
});
