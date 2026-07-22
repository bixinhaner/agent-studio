import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  CODEX_RUNTIME_ERROR_CODE,
  CodexRuntimeUserError
} from "../../codex-runtime-user-error.js";
import type { IntegrationInstanceRepositoryDb } from "../../persistence/integration-instance-repository.js";
import { createActionConnectorRuntimeRouter } from "./routes.js";

function createApp(locale: string) {
  const db = {
    integrationInstance: {
      findUnique: async () => ({
        id: "connector-1",
        type: "action_connector",
        status: "active",
        name: "Operations",
        slug: "operations",
        organizationId: "org-1"
      })
    },
    integrationInstanceConfig: {
      findUnique: async () => ({
        config: {
          displayName: "Operations"
        }
      })
    }
  } as unknown as IntegrationInstanceRepositoryDb;
  const app = express();
  app.use(express.json());
  app.use(createActionConnectorRuntimeRouter({
    db,
    codexRunner: async () => {
      throw new CodexRuntimeUserError(CODEX_RUNTIME_ERROR_CODE.AI_SERVICE_BUSY);
    }
  }));
  return request(app)
    .post("/connector-1/chat/stream")
    .set("Authorization", "Bearer delegated-token")
    .send({ message: "hello", locale });
}

describe("Action Connector runtime errors", () => {
  it("returns a stable code with a Chinese message", async () => {
    const response = await createApp("zh-CN").expect(200);

    expect(response.text).toContain('"code":"AI_SERVICE_BUSY"');
    expect(response.text).toContain('"message":"AI 服务当前繁忙，请稍后再试。"');
    expect(response.text).toContain('"retryable":true');
  });

  it("returns a stable code with an English message", async () => {
    const response = await createApp("en-US").expect(200);

    expect(response.text).toContain('"code":"AI_SERVICE_BUSY"');
    expect(response.text).toContain('"message":"The AI service is currently busy. Please try again later."');
  });
});
