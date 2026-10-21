import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { appConfig } from "./config.js";

import {
  ManagedCodexProviderResolver,
  createLocalAuthProviderSnapshot,
  createManagedCodexProviderSnapshot,
  normalizeManagedCodexProviderSnapshot,
  resolveManagedCodexDefaults
} from "./managed-codex-provider.js";
import { createDefaultSystemSettingsPayload } from "./system-settings/types.js";

describe("createManagedCodexProviderSnapshot", () => {
  it("uses a custom provider for OpenAI-compatible base URLs", () => {
    const snapshot = createManagedCodexProviderSnapshot({
      config: {
        providerKind: "openai_api",
        baseUrl: "https://example.com/v1",
        defaultModel: "gpt-5.4",
        defaultReasoningEffort: "high"
      },
      secrets: {
        apiKey: "openai-compatible-secret"
      }
    });

    expect(snapshot.kind).toBe("openai_api");
    expect(snapshot.runtimeOptions.apiKey).toBe("openai-compatible-secret");
    expect(snapshot.runtimeOptions.baseUrl).toBeUndefined();
    expect(snapshot.runtimeOptions.config).toEqual({
      model_provider: "agentstudio_openai_compatible",
      model_providers: {
        agentstudio_openai_compatible: {
          name: "Agent Studio OpenAI Compatible",
          base_url: "https://example.com/v1",
          env_key: "CODEX_API_KEY",
          wire_api: "responses"
        }
      }
    });
  });

  it("builds Azure OpenAI runtime options with query params and env overrides", () => {
    const snapshot = createManagedCodexProviderSnapshot({
      config: {
        providerKind: "azure_openai",
        baseUrl: "https://example.openai.azure.com",
        azureApiVersion: "2025-04-01-preview",
        defaultModel: "gpt-5-azure",
        defaultReasoningEffort: "high"
      },
      secrets: {
        apiKey: "azure-secret"
      }
    });

    expect(snapshot.kind).toBe("azure_openai");
    expect(snapshot.runtimeOptions.config).toEqual({
      model_provider: "azure",
      model_providers: {
        azure: {
          name: "Azure OpenAI",
          base_url: "https://example.openai.azure.com/openai",
          env_key: "AZURE_OPENAI_API_KEY",
          query_params: {
            "api-version": "2025-04-01-preview"
          },
          wire_api: "responses"
        }
      }
    });
    expect(snapshot.runtimeOptions.envOverrides).toEqual({
      AZURE_OPENAI_API_KEY: "azure-secret"
    });
  });
});

describe("DeepSeek context limits", () => {
  const deepseek = (baseUrl: string) => createManagedCodexProviderSnapshot({
    config: { providerKind: "openai_api", baseUrl, defaultModel: "deepseek-flash", defaultReasoningEffort: "high" },
    secrets: { apiKey: "test-key" }
  });

  it("gives the DeepSeek endpoint its 1M window so GPT-era threads are not compacted with the old model", () => {
    const config = deepseek("https://api.deepseek.com").runtimeOptions.config;
    expect(config).toMatchObject({
      model_auto_compact_token_limit: 600_000,
      model_provider: "agentstudio_openai_compatible"
    });
    const catalog = JSON.parse(readFileSync(config?.model_catalog_json, "utf8"));
    expect(catalog.models.map((model: { slug: string; context_window: number }) => [model.slug, model.context_window]))
      .toEqual([["deepseek-flash", 1_000_000], ["deepseek-v4-pro", 1_000_000]]);
  });

  it("sends DeepSeek traffic through the local image-shrinking proxy and leaves other gateways direct", () => {
    const providerOf = (baseUrl: string) =>
      deepseek(baseUrl).runtimeOptions.config?.model_providers?.agentstudio_openai_compatible?.base_url;
    expect(providerOf("https://api.deepseek.com")).toBe(`http://127.0.0.1:${appConfig.port}/internal/deepseek-proxy/api.deepseek.com`);
    expect(providerOf("https://example.com/v1")).toBe("https://example.com/v1");
  });

  it("leaves other gateways and ChatGPT sign-in on Codex's own model metadata", () => {
    expect(deepseek("https://example.com/v1").runtimeOptions.config).not.toHaveProperty("model_catalog_json");
    expect(deepseek("https://notdeepseek.com.example.org").runtimeOptions.config).not.toHaveProperty("model_catalog_json");
    expect(createLocalAuthProviderSnapshot().runtimeOptions.config ?? {}).not.toHaveProperty("model_catalog_json");
  });

  it("re-derives the limits for stored DeepSeek snapshots and does not persist them across a provider switch", () => {
    const stored = JSON.parse(JSON.stringify(deepseek("https://api.deepseek.com")));
    expect(normalizeManagedCodexProviderSnapshot(stored)?.runtimeOptions.config?.model_catalog_json).toMatch(/deepseek-\w+\.json$/);
    const switched = normalizeManagedCodexProviderSnapshot({ ...stored, kind: "openai_api",
      config: { ...stored.config, baseUrl: "https://example.com/v1", defaultModel: "gpt-5.4" } });
    expect(switched?.runtimeOptions.config).not.toHaveProperty("model_catalog_json");
    expect(switched?.runtimeOptions.config).not.toHaveProperty("model_auto_compact_token_limit");
  });
});

describe("normalizeManagedCodexProviderSnapshot", () => {
  it("re-derives runtime options for legacy OpenAI-compatible snapshots", () => {
    const snapshot = normalizeManagedCodexProviderSnapshot({
      version: 1,
      kind: "openai_api",
      source: "integration",
      integrationInstanceId: "provider-1",
      integrationSlug: "local-codex",
      integrationUpdatedAt: "2026-05-11T00:00:00.000Z",
      config: {
        providerKind: "openai_api",
        baseUrl: "https://example.com/v1",
        defaultModel: "gpt-5.4",
        defaultReasoningEffort: "high"
      },
      secrets: {
        apiKey: "openai-compatible-secret"
      },
      runtimeOptions: {
        baseUrl: "https://example.com/v1",
        apiKey: "openai-compatible-secret"
      }
    });

    expect(snapshot?.runtimeOptions.baseUrl).toBeUndefined();
    expect(snapshot?.runtimeOptions.apiKey).toBe("openai-compatible-secret");
    expect(snapshot?.runtimeOptions.config).toEqual({
      model_provider: "agentstudio_openai_compatible",
      model_providers: {
        agentstudio_openai_compatible: {
          name: "Agent Studio OpenAI Compatible",
          base_url: "https://example.com/v1",
          env_key: "CODEX_API_KEY",
          wire_api: "responses"
        }
      }
    });
  });

  it("preserves persisted memory runtime config during normalization", () => {
    const snapshot = normalizeManagedCodexProviderSnapshot({
      version: 1,
      kind: "chatgpt",
      source: "local_auth",
      config: {
        providerKind: "chatgpt",
        defaultModel: "gpt-5.4",
        defaultReasoningEffort: "high"
      },
      secrets: {},
      runtimeOptions: {
        config: {
          features: {
            memories: true
          },
          memories: {
            use_memories: true,
            generate_memories: false
          }
        }
      }
    });

    expect(snapshot?.runtimeOptions.config).toMatchObject({
      features: {
        memories: true
      },
      memories: {
        use_memories: true,
        generate_memories: false
      }
    });
  });
});

describe("ManagedCodexProviderResolver", () => {
  it("falls back to local auth when system settings request it", async () => {
    const resolver = new ManagedCodexProviderResolver({
      integrations: {
        async listOpenAICodexInstances() {
          return [
            {
              id: "provider-1",
              slug: "openai-main",
              status: "active",
              config: {
                providerKind: "azure_openai",
                baseUrl: "https://example.openai.azure.com/openai",
                azureApiVersion: "2025-04-01-preview",
                defaultModel: "azure-deployment",
                defaultReasoningEffort: "high"
              },
              secretState: {
                apiKey: "azure-secret"
              }
            }
          ];
        }
      },
      systemSettings: {
        async getCurrentPublished() {
          return {
            id: "settings-1",
            versionNumber: 1,
            revision: 1,
            status: "published",
            payload: {
              localBridgeVisibility: { mode: "selected", emails: [] },
              branding: {
                platformName: "Agent Studio",
                headerSubtitle: "test",
                internalLoginCopy: "test",
                externalLoginCopy: "external test",
                logoUrl: "",
                iconUrl: "",
                loginBackgroundUrl: "",
                portalWelcomeIllustrationUrl: "",
                assistantName: "test assistant",
                assistantAvatarUrl: ""
              },
              platformDefaults: {
                provider: "local_auth",
                model: "gpt-5.4",
                reasoningEffort: "high",
                sessionWorkspaceRoot: "/tmp/agent-studio"
              },
              retention: {
                sessionDays: 30,
                attachmentDays: 30,
                alertDays: 14
              },
              uploads: {
                maxSingleFileBytes: 10,
                maxTotalUploadBytes: 20
              },
              artifactAccess: createDefaultSystemSettingsPayload().artifactAccess,
              safety: {
                allowDangerFullAccess: false,
                allowNetworkAccess: true,
                allowLiveWebSearch: true,
                allowCustomAdditionalDirectories: false,
                allowFilesystemMutations: true,
                showAdminOperationsAndConversationMenus: true
              },
              conversationSecurityReview: createDefaultSystemSettingsPayload().conversationSecurityReview,
              organizationDefaults: {
                orgSyncIntervalMinutes: 60
              },
              codexMemory: createDefaultSystemSettingsPayload().codexMemory,
              enterpriseContext: createDefaultSystemSettingsPayload().enterpriseContext,
              pythonRuntime: createDefaultSystemSettingsPayload().pythonRuntime,
              adminEmailNotifications: createDefaultSystemSettingsPayload().adminEmailNotifications,
              behavior: {
                markdown: "test",
                portalWelcomeMessageDesktop: "Hello, I'm your {{assistantName}}.",
                portalWelcomeMessageMobile: "Hello there.",
                portalWelcomeSuggestions: [
                  {
                    label: "Suggestion",
                    prompt: "Prompt"
                  }
                ],
                answerFeedback: {
                  enabledForExternalUsers: true,
                  enabledForInternalUsers: false,
                  prompt: "Was this answer helpful?"
                }
              }
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
        }
      }
    });

    const snapshot = await resolver.resolveActiveProviderSnapshot();

    expect(snapshot.kind).toBe("chatgpt");
    // Codex native memory is the only generator, so default settings let it generate.
    expect(snapshot.runtimeOptions.config).toMatchObject({
      features: {
        memories: true
      },
      memories: {
        use_memories: true,
        generate_memories: true
      }
    });
  });

  it("merges published memory settings into active integration runtime config", async () => {
    const resolver = new ManagedCodexProviderResolver({
      integrations: {
        async listOpenAICodexInstances() {
          return [
            {
              id: "provider-1",
              slug: "openai-main",
              status: "active",
              config: {
                providerKind: "openai_api",
                baseUrl: "https://example.com/v1",
                defaultModel: "gpt-5.4",
                defaultReasoningEffort: "high"
              },
              secretState: {
                apiKey: "openai-secret"
              }
            }
          ];
        }
      },
      systemSettings: {
        async getCurrentPublished() {
          return {
            id: "settings-1",
            versionNumber: 1,
            revision: 1,
            status: "published" as const,
            payload: {
              ...createDefaultSystemSettingsPayload(),
              platformDefaults: {
                ...createDefaultSystemSettingsPayload().platformDefaults,
                provider: "openai_codex"
              },
              codexMemory: {
                ...createDefaultSystemSettingsPayload().codexMemory,
                minRateLimitRemainingPercent: 35
              }
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
        }
      }
    });

    const snapshot = await resolver.resolveActiveProviderSnapshot();

    expect(snapshot.runtimeOptions.config).toMatchObject({
      model_provider: "agentstudio_openai_compatible",
      features: {
        memories: true
      },
      memories: {
        min_rate_limit_remaining_percent: 35
      }
    });
  });
});

describe("resolveManagedCodexDefaults", () => {
  it("prefers published system settings over provider defaults", () => {
    const defaults = resolveManagedCodexDefaults({
      systemSettings: {
        id: "settings-1",
        versionNumber: 1,
        revision: 1,
        status: "published",
        payload: {
          localBridgeVisibility: { mode: "selected", emails: [] },
          branding: {
            platformName: "Agent Studio",
            headerSubtitle: "test",
            internalLoginCopy: "test",
            externalLoginCopy: "external test",
            logoUrl: "",
            iconUrl: "",
            loginBackgroundUrl: "",
            portalWelcomeIllustrationUrl: "",
            assistantName: "test assistant",
            assistantAvatarUrl: ""
          },
          platformDefaults: {
            provider: "openai_codex",
            model: "tenant-default-model",
            reasoningEffort: "medium",
            sessionWorkspaceRoot: "/tmp/agent-studio"
          },
          retention: {
            sessionDays: 30,
            attachmentDays: 30,
            alertDays: 14
          },
          uploads: {
            maxSingleFileBytes: 10,
            maxTotalUploadBytes: 20
          },
          artifactAccess: createDefaultSystemSettingsPayload().artifactAccess,
          safety: {
            allowDangerFullAccess: false,
            allowNetworkAccess: true,
            allowLiveWebSearch: true,
            allowCustomAdditionalDirectories: false,
            allowFilesystemMutations: true,
            showAdminOperationsAndConversationMenus: true
          },
          conversationSecurityReview: createDefaultSystemSettingsPayload().conversationSecurityReview,
          organizationDefaults: {
            orgSyncIntervalMinutes: 60
          },
          codexMemory: createDefaultSystemSettingsPayload().codexMemory,
          enterpriseContext: createDefaultSystemSettingsPayload().enterpriseContext,
          pythonRuntime: createDefaultSystemSettingsPayload().pythonRuntime,
          adminEmailNotifications: createDefaultSystemSettingsPayload().adminEmailNotifications,
          behavior: {
            markdown: "test",
            portalWelcomeMessageDesktop: "Hello, I'm your {{assistantName}}.",
            portalWelcomeMessageMobile: "Hello there.",
            portalWelcomeSuggestions: [
              {
                label: "Suggestion",
                prompt: "Prompt"
              }
            ],
            answerFeedback: {
              enabledForExternalUsers: true,
              enabledForInternalUsers: false,
              prompt: "Was this answer helpful?"
            }
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      providerSnapshot: createManagedCodexProviderSnapshot({
        config: {
          providerKind: "openai_api",
          defaultModel: "provider-default-model",
          defaultReasoningEffort: "high"
        },
        secrets: {
          apiKey: "test-key"
        }
      })
    });

    expect(defaults).toEqual({
      model: "tenant-default-model",
      reasoningEffort: "medium"
    });
  });

  it("replaces a model the run profile no longer allows with the profile default", () => {
    expect(
      resolveManagedCodexDefaults({
        model: "gpt-6.1-sol",
        reasoningEffort: "high",
        runProfile: { defaultModel: "deepseek-flash", allowedModels: ["deepseek-flash"], defaultReasoningEffort: "max" }
      })
    ).toEqual({ model: "deepseek-flash", reasoningEffort: "max" });
  });

  it("keeps an allowed model and its effort", () => {
    expect(
      resolveManagedCodexDefaults({
        model: "gpt-6-sol",
        reasoningEffort: "medium",
        runProfile: { defaultModel: "gpt-6.1-sol", allowedModels: ["gpt-6-sol", "gpt-6.1-sol"], defaultReasoningEffort: "high" }
      })
    ).toEqual({ model: "gpt-6-sol", reasoningEffort: "medium" });
  });

  it("does not constrain when the run profile lists no models", () => {
    expect(
      resolveManagedCodexDefaults({
        model: "gpt-6-sol",
        reasoningEffort: "medium",
        runProfile: { defaultModel: "gpt-6.1-sol", allowedModels: [], defaultReasoningEffort: "high" }
      })
    ).toEqual({ model: "gpt-6-sol", reasoningEffort: "medium" });
  });
});
