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
        metadata: {
          source: "chat_stream",
          _costProfile: { costCompleteness: "partial_missing_cache_write_tokens" }
        },
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
    expect(response.summary.totalTokens).toBe(440);
    expect(response.summary.internalCost).toBe("5.100000");
    expect(response.summary.avgInternalCostPerRequest).toBe("1.700000");
    expect(response.summary.incompleteCostRequestCount).toBe(1);

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
      totalTokens: 300
    });
  });

  it("keeps security review usage out of business activity and the session ledger", () => {
    const usageEvents = [
      makeUsageEvent({
        id: "evt-chat",
        organizationId: "org-a",
        userId: "user-a",
        threadId: "thread-a",
        sessionId: "session-a",
        model: "gpt-5.6",
        featureType: "chat",
        inputTokens: 1000,
        cachedInputTokens: 500,
        outputTokens: 200,
        estimatedCost: "1.200000",
        internalCost: "0.120000",
        metadata: { source: "chat_stream" },
        createdAt: "2026-04-15T01:00:00.000Z"
      }),
      makeUsageEvent({
        id: "evt-review-failed-retry",
        organizationId: "org-a",
        userId: "user-a",
        threadId: "thread-a",
        model: "gpt-5.6",
        featureType: "security_review",
        resultStatus: "failed",
        metadata: { source: "conversation_security_review", reviewId: "review-a" },
        createdAt: "2026-04-15T01:01:00.000Z"
      }),
      makeUsageEvent({
        id: "evt-review-success",
        organizationId: "org-a",
        userId: "user-a",
        threadId: "thread-a",
        model: "gpt-5.6",
        featureType: "security_review",
        inputTokens: 300,
        cachedInputTokens: 100,
        outputTokens: 40,
        estimatedCost: "0.300000",
        internalCost: "0.030000",
        metadata: { source: "conversation_security_review", reviewId: "review-a" },
        createdAt: "2026-04-15T01:02:00.000Z"
      }),
      makeUsageEvent({
        id: "evt-review-failed-terminal",
        organizationId: "org-a",
        userId: "user-b",
        threadId: "thread-b",
        model: "gpt-5.6",
        featureType: "security_review",
        resultStatus: "failed",
        metadata: { source: "conversation_security_review", reviewId: "review-b" },
        createdAt: "2026-04-15T01:03:00.000Z"
      })
    ];

    const response = buildOperationsInsights({
      usageEvents,
      sessionsById: new Map(),
      organizationsById: new Map([
        ["org-a", { id: "org-a", slug: "alpha", name: "Alpha Corp", type: "internal", status: "active", createdAt: "", updatedAt: "" }]
      ]),
      usersById: new Map([
        ["user-a", { id: "user-a", displayName: "Alice", email: "alice@example.com", createdAt: "", updatedAt: "" }],
        ["user-b", { id: "user-b", displayName: "Bob", email: "bob@example.com", createdAt: "", updatedAt: "" }]
      ]),
      departmentsById: new Map(),
      filters: {
        days: 30,
        timeZone: "Asia/Shanghai",
        sessionPage: 1,
        sessionPageSize: 20
      },
      now: new Date("2026-04-16T00:00:00.000Z")
    });

    expect(response.summary).toMatchObject({
      totalOrganizations: 1,
      totalUsers: 1,
      totalSessions: 1,
      totalRequests: 1,
      totalTokens: 1200,
      estimatedCost: "1.200000",
      internalCost: "0.120000"
    });
    expect(response.trends).toEqual([
      expect.objectContaining({
        sessionCount: 1,
        requestCount: 1,
        totalTokens: 1200
      })
    ]);
    expect(response.breakdowns.entries.map((item) => item.key)).not.toContain("security_review");
    expect(response.sessions).toMatchObject({
      totalItems: 1,
      items: [expect.objectContaining({ sessionId: "session-a", requestCount: 1 })]
    });
    expect(response.securityReview).toEqual({
      reviewJobCount: 2,
      successfulReviewCount: 1,
      failedAttemptCount: 2,
      affectedThreadCount: 2,
      affectedUserCount: 2,
      inputTokens: 300,
      cachedInputTokens: 100,
      outputTokens: 40,
      totalTokens: 340,
      estimatedCost: "0.300000",
      internalCost: "0.030000"
    });
  });

  it("labels Zendesk usage as a first-class operations analytics source", () => {
    const usageEvents = [
      makeUsageEvent({
        id: "evt-zendesk-1",
        organizationId: "org-z",
        userId: "zendesk-bot:zendesk-1",
        threadId: "thread-zendesk-45268",
        sessionId: "zendesk:zendesk-1:ticket:45268",
        model: "gpt-5.5",
        featureType: "chat",
        inputTokens: 1000,
        cachedInputTokens: 200,
        outputTokens: 300,
        estimatedCost: "0.750000",
        internalCost: "1.500000",
        metadata: {
          source: "zendesk",
          actorName: "Zendesk 自动回复",
          integrationSlug: "zendesk-main",
          ticketId: "45268",
          runId: "run-zendesk-1"
        },
        createdAt: "2026-04-15T06:00:00.000Z"
      })
    ];

    const response = buildOperationsInsights({
      usageEvents,
      sessionsById: new Map(),
      organizationsById: new Map([
        ["org-z", { id: "org-z", slug: "zeta", name: "Zeta Support", type: "customer", status: "active", createdAt: "", updatedAt: "" }]
      ]),
      usersById: new Map(),
      departmentsById: new Map(),
      filters: {
        days: 30,
        timeZone: "Asia/Shanghai",
        sessionPage: 1,
        sessionPageSize: 20
      },
      now: new Date("2026-04-16T00:00:00.000Z")
    });

    expect(response.summary.totalSessions).toBe(1);
    expect(response.summary.totalUsers).toBe(1);
    expect(response.breakdowns.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "zendesk",
          label: "Zendesk 自动回复",
          requestCount: 1
        })
      ])
    );
    expect(response.breakdowns.paths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "zendesk:zendesk-main",
          label: "Zendesk 自动回复 · zendesk-main",
          totalTokens: 1300
        })
      ])
    );
    expect(response.users[0]).toMatchObject({
      userId: "zendesk-bot:zendesk-1",
      userName: "Zendesk 自动回复",
      organizationName: "Zeta Support"
    });
    expect(response.sessions.items[0]).toMatchObject({
      sessionId: "zendesk:zendesk-1:ticket:45268",
      threadId: "thread-zendesk-45268",
      userName: "Zendesk 自动回复",
      pathLabel: "Zendesk 自动回复 · zendesk-main",
      totalTokens: 1300
    });
  });
});
