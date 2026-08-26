import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAccessRequestReviewRouter } from "./review-router.js";

function createHarness() {
  const service = {
    getExternalReviewerView: vi.fn(async (requestId: string, token: string) => ({
      request: { id: requestId },
      viewer: { reviewerId: "reviewer_1", reviewerEmail: "lion.li@cloud-ran.ai", deliveryType: "to", decision: "pending" },
      token
    })),
    submitExternalReviewerDecision: vi.fn(async () => ({ reviewer: {}, request: {} }))
  };
  const app = express();
  app.use(express.json());
  app.use(createAccessRequestReviewRouter(service as never));
  return { app, service };
}

describe("access request review router", () => {
  it("allows a scoped external review token without an internal session", async () => {
    const { app, service } = createHarness();

    await request(app).get("/request_1?token=secure-token").expect(200);

    expect(service.getExternalReviewerView).toHaveBeenCalledWith("request_1", "secure-token");
  });

  it("keeps tokenless review access restricted to internal users", async () => {
    const { app } = createHarness();

    await request(app).get("/request_1").expect(403, { detail: "Internal reviewer access is required" });
  });
});
