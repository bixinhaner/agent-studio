import { describe, expect, it } from "vitest";

import {
  ManagedCodexProviderResolver,
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
                allowFilesystemMutations: true
              },
              organizationDefaults: {
                orgSyncIntervalMinutes: 60
              },
              codexMemory: createDefaultSystemSettingsPayload().codexMemory,
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
            allowFilesystemMutations: true
          },
          organizationDefaults: {
            orgSyncIntervalMinutes: 60
          },
          codexMemory: createDefaultSystemSettingsPayload().codexMemory,
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
});
