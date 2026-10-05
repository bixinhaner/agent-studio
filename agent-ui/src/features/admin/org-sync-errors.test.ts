import { describe, expect, it } from "vitest";

import { explainSyncFailure, jobFailureExplanation, latestFinishedJob } from "./org-sync-errors";
import type { OrgSyncJob } from "./types";

const job = (status: string, detail?: string) => ({ id: status, status, summary: detail ? { detail } : null }) as unknown as OrgSyncJob;

describe("org sync failure explanations", () => {
  it("explains DingTalk QPS throttling and keeps the raw message", () => {
    const raw = "ding talk error[subcode=90002,submsg=当前所有钉钉应用调用该接口次数过多，超出了该接口承受的最大qps]";
    const result = explainSyncFailure(raw);
    expect(result.reason).toContain("限流");
    expect(result.raw).toBe(raw);
  });

  it("maps credential and permission errors", () => {
    expect(explainSyncFailure("errcode 40014 invalid access_token").reason).toContain("凭证");
    expect(explainSyncFailure("errcode=60011 no permission").reason).toContain("权限");
  });

  it("falls back to the raw text for unknown errors", () => {
    expect(explainSyncFailure("something odd").reason).toBe("something odd");
  });

  it("only flags the latest finished job when it failed", () => {
    expect(latestFinishedJob([job("running"), job("failed", "x"), job("succeeded")])?.status).toBe("failed");
    expect(jobFailureExplanation(latestFinishedJob([job("succeeded"), job("failed", "x")]))).toBeUndefined();
    expect(jobFailureExplanation(job("failed"))?.reason).toContain("未返回原因");
  });
});
