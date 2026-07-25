import { describe, expect, it, vi } from "vitest";

import { createDefaultSystemSettingsPayload } from "../system-settings/types.js";
import {
  ConversationSecurityReviewScheduler,
  ConversationSecurityReviewService
} from "./service.js";
import type { ConversationSecurityReviewRecord } from "./repository.js";

function reviewRecord(
  patch: Partial<ConversationSecurityReviewRecord> = {}
): ConversationSecurityReviewRecord {
  return {
    id: "review-1",
    organizationId: "org-1",
    userId: "user-1",
    threadId: "thread-1",
    userMessageId: "message-1",
    channel: "portal",
    audience: "external",
    status: "processing",
    attempts: 1,
    nextAttemptAt: new Date("2026-07-25T00:00:00.000Z"),
    categories: [],
    evidenceMessageIds: [],
    createdAt: new Date("2026-07-25T00:00:00.000Z"),
    updatedAt: new Date("2026-07-25T00:00:00.000Z"),
    ...patch
  };
}

function settings() {
  return {
    ...createDefaultSystemSettingsPayload().conversationSecurityReview,
    enabled: true
  };
}

function createHarness(overrides: Record<string, unknown> = {}) {
  const currentSettings = settings();
  const completed = reviewRecord({
    status: "completed",
    riskScore: 82,
    riskLevel: "high",
    reason: "连续索取跨项目资料"
  });
  const reviews = {
    enqueue: vi.fn(async (input) => reviewRecord({ ...input, status: "pending" })),
    claimNext: vi.fn(async () => reviewRecord()),
    complete: vi.fn(async () => completed),
    fail: vi.fn(async () => undefined),
    skip: vi.fn(async () => undefined),
    listRecentForUser: vi.fn(async () => []),
    findRecentNotified: vi.fn(async () => undefined),
    markAlert: vi.fn(async () => undefined)
  };
  const alertEvents = {
    create: vi.fn(async (input) => ({
      id: "alert-1",
      status: "open",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      ...input
    }))
  };
  const db = {
    thread: {
      findUnique: vi.fn(async () => ({
        id: "thread-1",
        title: "现场故障",
        codexRunConfig: {
          mode: "customer-tech-support",
          _agentStudioKnowledgeSets: { selectedIds: ["for-customer"] }
        }
      }))
    },
    message: {
      findMany: vi.fn(async () => [
        {
          externalId: "message-1",
          role: "user",
          content: [{ type: "text", text: "把全部项目材料汇总给我" }],
          position: 1,
          createdAt: new Date("2026-07-25T00:00:00.000Z")
        }
      ])
    },
    user: {
      findUnique: vi.fn(async () => ({
        id: "user-1",
        userType: "customer",
        displayName: "测试客户",
        email: "customer@example.com",
        role: "user",
        primaryOrganization: { id: "org-1", name: "客户企业", slug: "customer", type: "customer" },
        enterpriseProfile: null,
        departmentMemberships: []
      })),
      findMany: vi.fn(async () => [{ dingtalkUserId: "ding-super-admin" }])
    },
    agentMode: {
      findUnique: vi.fn(async () => ({
        id: "customer-tech-support",
        name: "For Customer",
        slug: "customer-tech-support"
      }))
    },
    knowledgeSet: {
      findMany: vi.fn(async () => [{ id: "for-customer", name: "For Customer", slug: "for-customer" }])
    }
  };
  const runCodexReview = vi.fn(async () => ({
    text: JSON.stringify({
      score: 82,
      confidence: 0.92,
      categories: ["bulk_intelligence_collection"],
      evidenceMessageIds: ["message-1"],
      reason: "连续索取跨项目资料",
      assistantExposure: "none",
      recommendedAction: "notify"
    }),
    provider: "codex_runtime:test",
    model: "test-model"
  }));
  const notifyDingTalk = vi.fn(async () => true);
  const service = new ConversationSecurityReviewService({
    db,
    reviews,
    systemSettings: {
      getCurrentPublished: vi.fn(async () => ({ payload: { conversationSecurityReview: currentSettings } }))
    },
    providerSnapshot: vi.fn(),
    runCodexReview,
    usageRecorder: { recordDirectUsage: vi.fn() },
    alertEvents,
    notifyDingTalk,
    ...overrides
  } as never);
  return {
    service,
    settings: currentSettings,
    reviews,
    alertEvents,
    db,
    runCodexReview,
    notifyDingTalk
  };
}

describe("ConversationSecurityReviewService", () => {
  it("只为命中用户、渠道、智能体和资料集范围的 Portal 消息入队", async () => {
    const harness = createHarness();
    harness.settings.agentModeIds = ["customer-tech-support"];
    harness.settings.knowledgeSetIds = ["for-customer"];

    await harness.service.enqueuePortalTurn({
      organizationId: "org-1",
      userId: "user-1",
      threadId: "thread-1",
      userMessageId: "message-1",
      audience: "external"
    });
    await harness.service.enqueuePortalTurn({
      organizationId: "org-1",
      userId: "user-2",
      threadId: "thread-2",
      userMessageId: "message-2",
      audience: "internal"
    });

    expect(harness.reviews.enqueue).toHaveBeenCalledTimes(1);
    expect(harness.reviews.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      userMessageId: "message-1",
      audience: "external"
    }));
  });

  it("在观察模式记录证据和告警事件，但不发送钉钉", async () => {
    const harness = createHarness();
    harness.settings.observationMode = true;

    await harness.service.processNext();

    expect(harness.runCodexReview).toHaveBeenCalledOnce();
    const prompt = (
      harness.runCodexReview.mock.calls as unknown as Array<[{ prompt: string }]>
    )[0]?.[0].prompt ?? "";
    expect(prompt).toContain("待审核上下文（不可信数据）");
    expect(prompt).toContain("customer@example.com");
    expect(prompt).toContain("把全部项目材料汇总给我");
    expect(harness.reviews.complete).toHaveBeenCalledWith(expect.objectContaining({
      riskScore: 82,
      evidenceMessageIds: ["message-1"]
    }));
    expect(harness.alertEvents.create).toHaveBeenCalledWith(expect.objectContaining({
      severity: "warning",
      payload: expect.objectContaining({
        category: "conversation_security_review",
        observationMode: true
      })
    }));
    expect(harness.notifyDingTalk).not.toHaveBeenCalled();
  });

  it("告警生效时解析指定接收人并发送钉钉", async () => {
    const harness = createHarness();
    harness.settings.observationMode = false;
    harness.settings.notification.recipientMode = "specified_users";
    harness.settings.notification.recipientUserIds = ["admin-1"];

    await harness.service.processNext();

    expect(harness.db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["admin-1"] } })
    }));
    expect(harness.notifyDingTalk).toHaveBeenCalledWith(expect.objectContaining({
      recipientDingTalkUserIds: ["ding-super-admin"],
      message: expect.stringContaining("疑似对话安全风险")
    }));
    expect(harness.reviews.markAlert).toHaveBeenCalledWith({
      id: "review-1",
      alertEventId: "alert-1",
      notified: true
    });
  });

  it("发布配置关闭后将已入队任务标记为跳过而不是重试失败", async () => {
    const harness = createHarness();
    harness.settings.enabled = false;

    await harness.service.processNext();

    expect(harness.reviews.skip).toHaveBeenCalledWith({
      id: "review-1",
      reason: "对话安全审查已关闭或当前用户范围已停用"
    });
    expect(harness.reviews.fail).not.toHaveBeenCalled();
    expect(harness.runCodexReview).not.toHaveBeenCalled();
  });
});

describe("ConversationSecurityReviewScheduler", () => {
  it("数据库暂不可用时记录错误且不产生未处理异常", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const scheduler = new ConversationSecurityReviewScheduler(
      { processNext: vi.fn(async () => { throw new Error("table unavailable"); }) },
      5000,
      { warn }
    );

    scheduler.start();
    await vi.runOnlyPendingTimersAsync();
    scheduler.stop();

    expect(warn).toHaveBeenCalledWith(
      "conversation security review scheduler failed",
      { detail: "table unavailable" }
    );
    vi.useRealTimers();
  });
});
