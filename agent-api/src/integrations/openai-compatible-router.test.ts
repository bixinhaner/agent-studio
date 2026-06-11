import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createOpenAICompatibleRouter } from "./openai-compatible-router.js";

const cleanupPaths: string[] = [];

async function makeTempDir(): Promise<string> {
  const root = path.resolve(process.cwd(), "../temp");
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, "openai-compatible-router-"));
  cleanupPaths.push(dir);
  return dir;
}

describe("openai compatible router runtime scope", () => {
  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((item) => fs.rm(item, { recursive: true, force: true })));
  });

  it("uses shared integration workspace and CODEX_HOME for chat completions", async () => {
    const workspaceRoot = await makeTempDir();
    const startCalls: Array<{
      workspace: string;
      codexRunConfig?: Record<string, unknown>;
    }> = [];
    const materializeCalls: Array<{
      provider: string;
      integrationInstanceId: string;
      modeId: string;
      codexRunConfig?: Record<string, unknown>;
    }> = [];
    const requestRuntime = {
      async startThreadWithOptions(options: {
        workspace: string;
        codexRunConfig?: Record<string, unknown>;
      }) {
        startCalls.push(options);
        return { id: "codex-thread-1" };
      },
      async *runStreamed() {
        yield* [];
      }
    };

    const app = express();
    app.use(express.json());
    app.use(createOpenAICompatibleRouter({
      runtime: {
        async startThreadWithOptions() {
          throw new Error("default runtime should not be used");
        },
        async *runStreamed() {
          yield* [];
        }
      },
      createRuntimeForRequest: ({ codexHome }) => {
        expect(codexHome).toBe("/tmp/shared-codex-home");
        return requestRuntime;
      },
      materializeCodexHome: async (input) => {
        materializeCalls.push(input);
        return {
          codexHome: "/tmp/shared-codex-home",
          codexRunConfig: {
            ...input.codexRunConfig,
            _agentStudioCodexHome: "/tmp/shared-codex-home"
          }
        };
      },
      integrationsDb: {
        integrationInstance: {
          findMany: async () => [{
            id: "instance/42",
            organizationId: "org-1",
            type: "openai_compatible_api",
            slug: "support/api",
            name: "Support API",
            status: "active"
          }]
        },
        integrationInstanceConfig: {
          findMany: async () => [{
            integrationInstanceId: "instance/42",
            config: {
              agentModeId: "support/copilot",
              knowledgeSetIds: ["ks-1"]
            }
          }]
        },
        integrationInstanceSecret: {
          findMany: async () => [{
            integrationInstanceId: "instance/42",
            secretState: { apiKey: "test-key" }
          }]
        }
      },
      agentModes: {
        get: async () => ({
          id: "support/copilot",
          name: "Support",
          status: "active",
          runProfileId: "run-profile-1",
          instructionSources: []
        })
      },
      runProfiles: {
        get: async () => ({
          id: "run-profile-1",
          status: "active",
          defaultModel: "gpt-5-mini",
          allowedModels: ["gpt-5-mini"],
          defaultReasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "disabled"
        })
      },
      knowledgeSets: {
        list: async () => [{
          id: "ks-1",
          name: "Docs",
          slug: "docs",
          status: "active",
          sourceType: "managed_upload",
          storageKey: "docs-storage-key"
        }]
      },
      knowledgeSetStorage: {
        resolveReadableMountPath: (key) => `/knowledge/${key}`
      },
      codexExecution: {
        collectFromRuntime: async (input) => {
          expect(input.runtime).toBe(requestRuntime);
          expect(input.thread).toEqual({ id: "codex-thread-1" });
          expect(input.prompt).toContain("hello");
          return {
            answer: "ok",
            usage: {
              inputTokens: 10,
              cachedInputTokens: 2,
              outputTokens: 3
            }
          };
        }
      },
      sessionWorkspaceRoot: workspaceRoot,
      defaultModel: "gpt-5-mini",
      defaultReasoningEffort: "medium"
    }));

    const response = await request(app)
      .post("/chat/completions")
      .set("Authorization", "Bearer test-key")
      .send({
        messages: [{ role: "user", content: "hello" }]
      })
      .expect(200);

    expect(response.body.choices[0].message.content).toBe("ok");
    expect(materializeCalls).toHaveLength(1);
    expect(materializeCalls[0]).toMatchObject({
      provider: "openai-compatible",
      integrationInstanceId: "instance/42",
      modeId: "support/copilot"
    });
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0].workspace).toBe(path.join(
      workspaceRoot,
      "integrations",
      "openai-compatible",
      "instance_42",
      "agent-support_copilot"
    ));
    expect(startCalls[0].codexRunConfig).toMatchObject({
      mode: "support/copilot",
      _agentStudioCodexHome: "/tmp/shared-codex-home"
    });
    expect(startCalls[0].codexRunConfig?.additionalDirectories).toEqual(["/knowledge/docs-storage-key"]);
  });
});
