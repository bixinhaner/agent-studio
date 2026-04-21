import { describe, expect, it } from "vitest";

import {
  ManagedCodexProviderResolver,
  createManagedCodexProviderSnapshot,
  resolveManagedCodexDefaults
} from "./managed-codex-provider.js";

describe("createManagedCodexProviderSnapshot", () => {
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
                loginCopy: "test",
                logoUrl: "",
                iconUrl: "",
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
              behavior: {
                markdown: "test",
                portalWelcomeMessageDesktop: "Hello, I'm your {{assistantName}}.",
                portalWelcomeMessageMobile: "Hello there.",
                portalWelcomeSuggestions: [
                  {
                    label: "Suggestion",
                    prompt: "Prompt"
                  }
                ]
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
    expect(snapshot.runtimeOptions).toEqual({});
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
            loginCopy: "test",
            logoUrl: "",
            iconUrl: "",
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
          behavior: {
            markdown: "test",
            portalWelcomeMessageDesktop: "Hello, I'm your {{assistantName}}.",
            portalWelcomeMessageMobile: "Hello there.",
            portalWelcomeSuggestions: [
              {
                label: "Suggestion",
                prompt: "Prompt"
              }
            ]
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
