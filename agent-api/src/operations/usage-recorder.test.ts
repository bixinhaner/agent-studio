import { describe, expect, it } from "vitest";

import { UsageRecorder } from "./usage-recorder.js";
import type { RecordUsageInput } from "./usage-ingestion-service.js";

function usageEventFromInput(input: RecordUsageInput) {
  return {
    id: "usage-1",
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
    estimatedCost: "0.000000",
    internalCost: "0.000000",
    resultStatus: input.resultStatus ?? "success",
    metadata: input.metadata,
    createdAt: "2026-06-10T00:00:00.000Z"
  };
}

describe("UsageRecorder", () => {
  it("centralizes Codex runtime usage conversion before ingestion", async () => {
    let codexInput: RecordUsageInput | undefined;
    const recorder = new UsageRecorder({
      usageIngestion: {
        async recordCodexRuntimeUsage(input) {
          codexInput = input;
          return usageEventFromInput(input);
        },
        async record(input) {
          return usageEventFromInput(input);
        }
      }
    });

    await recorder.recordCodexUsage({
      organizationId: "org-1",
      userId: "user-1",
      departmentIdSnapshot: "dept-1",
      threadId: "thread-1",
      sessionId: "session-1",
      model: "gpt-5.5",
      featureType: "chat",
      codexThreadId: "fallback-thread",
      resultStatus: "failed",
      metadata: {
        source: "dingtalk_bot"
      },
      usage: {
        inputTokens: 1200,
        cachedInputTokens: 400,
        outputTokens: 80,
        kind: "turn_delta",
        cumulativeInputTokens: 5000,
        cumulativeCachedInputTokens: 3000,
        cumulativeOutputTokens: 500,
        codexThreadId: "runtime-thread"
      }
    });

    expect(codexInput).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      departmentIdSnapshot: "dept-1",
      threadId: "thread-1",
      sessionId: "session-1",
      model: "gpt-5.5",
      featureType: "chat",
      inputTokens: 1200,
      cachedInputTokens: 400,
      outputTokens: 80,
      codexRuntimeUsageKind: "turn_delta",
      codexRuntimeCumulativeUsage: {
        inputTokens: 5000,
        cachedInputTokens: 3000,
        outputTokens: 500
      },
      codexThreadId: "runtime-thread",
      resultStatus: "failed",
      metadata: {
        source: "dingtalk_bot",
        codexThreadId: "runtime-thread"
      }
    });
  });

  it("records zero Codex usage through the same path when runtime usage is unavailable", async () => {
    let codexInput: RecordUsageInput | undefined;
    const recorder = new UsageRecorder({
      usageIngestion: {
        async recordCodexRuntimeUsage(input) {
          codexInput = input;
          return usageEventFromInput(input);
        },
        async record(input) {
          return usageEventFromInput(input);
        }
      }
    });

    await recorder.recordCodexUsage({
      sessionId: "external-request-1",
      model: "gpt-5.5",
      featureType: "external_openai_api",
      resultStatus: "failed",
      metadata: {
        source: "external_openai_api"
      }
    });

    expect(codexInput).toMatchObject({
      sessionId: "external-request-1",
      model: "gpt-5.5",
      featureType: "external_openai_api",
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      codexRuntimeUsageKind: "turn_delta",
      resultStatus: "failed",
      metadata: {
        source: "external_openai_api"
      }
    });
  });

  it("keeps direct usage recording available for non-Codex metered sources", async () => {
    let directInput: RecordUsageInput | undefined;
    const recorder = new UsageRecorder({
      usageIngestion: {
        async recordCodexRuntimeUsage(input) {
          return usageEventFromInput(input);
        },
        async record(input) {
          directInput = input;
          return usageEventFromInput(input);
        }
      }
    });

    await recorder.recordDirectUsage({
      organizationId: "org-1",
      sessionId: "metered-1",
      model: "gpt-5.5",
      featureType: "external_openai_api",
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 3,
      resultStatus: "success"
    });

    expect(directInput).toMatchObject({
      organizationId: "org-1",
      sessionId: "metered-1",
      model: "gpt-5.5",
      featureType: "external_openai_api",
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 3,
      resultStatus: "success"
    });
  });
});
