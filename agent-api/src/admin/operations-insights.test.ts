import { describe, expect, it } from "vitest";

import { buildOperationsInsights } from "./operations-insights.js";
import type { SessionRecord } from "../persistence/session-repository.js";
import type { UsageEventRecord } from "../persistence/usage-event-repository.js";

function makeUsageEvent(input: Partial<UsageEventRecord> & Pick<UsageEventRecord, "id" | "model" | "featureType" | "createdAt">): UsageEventRecord {
  return {
    id: input.id,
    organizationId: input.organizationId,
    userId: input.userId,
    departmentIdSnapshot: input.departmentIdSnapshot,
    threadId: input.threadId,
    sessionId: input.sessionId,
    model: input.model,
    featureType: input.featureType,
    inputTokens: input.inputTokens ?? 0,
    cachedInputTokens: input.cachedInputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    estimatedCost: input.estimatedCost ?? "0.000000",
    internalCost: input.internalCost ?? "0.000000",
    resultStatus: input.resultStatus ?? "success",
    metadata: input.metadata,
    createdAt: input.createdAt
  };
}

function makeSession(input: Partial<SessionRecord> & Pick<SessionRecord, "sessionId" | "model" | "reasoningEffort" | "workspace" | "createdAt" | "updatedAt">): SessionRecord {
  return {
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    userId: input.userId,
    threadId: input.threadId,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    workspace: input.workspace,
    codexRunConfig: input.codexRunConfig,
    codexThreadId: input.codexThreadId,
    providerSnapshot: input.providerSnapshot,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

describe("buildOperationsInsights", () => {
  it("aggregates chat and external API usage into user, organization, path, and session views", () => {
    const usageEvents = [
      makeUsageEvent({
        id: "evt-chat-1",
        organizationId: "org-a",
        userId: "user-a",
        departmentIdSnapshot: "dept-a",
        threadId: "thread-a",
        sessionId: "sess-a",
        model: "gpt-5.4-mini",
        featureType: "chat",
        inputTokens: 120,
        cachedInputTokens: 30,
        outputTokens: 80,
        estimatedCost: "1.250000",
        internalCost: "2.500000",
        metadata: { source: "chat_stream" },
        createdAt: "2026-04-15T01:00:00.000Z"
      }),
      makeUsageEvent({
        id: "evt-chat-2",
        organizationId: "org-a",
        userId: "user-a",
        departmentIdSnapshot: "dept-a",
        threadId: "thread-a",
        sessionId: "sess-a",
        model: "gpt-5.4-mini",
        featureType: "chat",
        inputTokens: 60,
        cachedInputTokens: 10,
        outputTokens: 40,
        estimatedCost: "0.500000",
        internalCost: "1.000000",
        metadata: { source: "chat_stream" },
        createdAt: "2026-04-15T02:00:00.000Z"
      }),
      makeUsageEvent({
        id: "evt-api-1",
        organizationId: "org-b",
        featureType: "external_openai_api",
        sessionId: "ext-1",
        model: "gpt-4o-mini",
        inputTokens: 90,
        outputTokens: 50,
        estimatedCost: "0.800000",
        internalCost: "1.600000",
        metadata: {
          source: "openai_compatible_api",
          integrationSlug: "partner-gateway"
        },
        createdAt: "2026-04-15T05:00:00.000Z"
      })
    ];

    const sessions = new Map<string, SessionRecord>([
      [
        "sess-a",
        makeSession({
          sessionId: "sess-a",
          organizationId: "org-a",
          userId: "user-a",
          threadId: "thread-a",
          model: "gpt-5.4-mini",
          reasoningEffort: "medium",
          workspace: "/tmp/workspace-a",
          createdAt: "2026-04-15T00:50:00.000Z",
          updatedAt: "2026-04-15T02:00:00.000Z",
          providerSnapshot: {
            version: 1,
            kind: "azure_openai",
            source: "integration",
            integrationInstanceId: "int-azure",
            integrationSlug: "azure-openai",
            config: {
              providerKind: "azure_openai",
              baseUrl: "https://example.openai.azure.com/openai",
              azureApiVersion: "2025-04-01-preview",
              defaultModel: "gpt-5.4-mini",
              defaultReasoningEffort: "medium"
            },
            secrets: {},
            runtimeOptions: {}
          }
        })
      ]
    ]);

    const response = buildOperationsInsights({
      usageEvents,
      sessionsById: sessions,
      organizationsById: new Map([
        ["org-a", { id: "org-a", slug: "alpha", name: "Alpha Corp", type: "customer", status: "active", createdAt: "", updatedAt: "" }],
        ["org-b", { id: "org-b", slug: "beta", name: "Beta Inc", type: "customer", status: "active", createdAt: "", updatedAt: "" }]
      ]),
      usersById: new Map([["user-a", { id: "user-a", displayName: "Alice", email: "alice@example.com", createdAt: "", updatedAt: "" }]]),
      departmentsById: new Map([["dept-a", { id: "dept-a", externalId: "dept-a", name: "Customer Success", sortOrder: 1, status: "active", createdAt: "", updatedAt: "" }]]),
      filters: {
        days: 30,
        timeZone: "Asia/Shanghai",
        sessionPage: 1,
        sessionPageSize: 20
      },
      now: new Date("2026-04-16T00:00:00.000Z")
    });

    expect(response.summary.totalSessions).toBe(2);
    expect(response.summary.totalOrganizations).toBe(2);
    expect(response.summary.totalUsers).toBe(1);
    expect(response.summary.totalRequests).toBe(3);
    expect(response.summary.totalTokens).toBe(480);
    expect(response.summary.internalCost).toBe("5.100000");

    expect(response.breakdowns.paths[0]?.label).toBe("AI 助手工作台 · 管理台集成 · Azure OpenAI · azure-openai");
    expect(response.breakdowns.entries.map((item) => item.label)).toContain("外部 OpenAI API");

    expect(response.organizations[0]).toMatchObject({
      organizationName: "Alpha Corp",
      sessionCount: 1,
      requestCount: 2,
      topModel: "gpt-5.4-mini"
    });

    expect(response.users[0]).toMatchObject({
      userName: "Alice",
      organizationName: "Alpha Corp",
      sessionCount: 1
    });

    expect(response.sessions.items[0]).toMatchObject({
      sessionId: "ext-1",
      pathLabel: "外部 OpenAI API · partner-gateway"
    });
    expect(response.sessions.items[1]).toMatchObject({
      sessionId: "sess-a",
      userName: "Alice",
      pathLabel: "AI 助手工作台 · 管理台集成 · Azure OpenAI · azure-openai",
      requestCount: 2,
      totalTokens: 340
    });
  });
});
