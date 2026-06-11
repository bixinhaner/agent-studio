import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildIntegrationAgentWorkspacePath,
  buildSharedIntegrationCodexHomeScope,
  buildSharedCodexHomeScope,
  buildUserAgentWorkspacePath,
  isIntegrationAgentWorkspacePath,
  isUserAgentWorkspacePath
} from "./runtime-scope-resolver.js";

describe("runtime scope resolver", () => {
  const actor = {
    organizationId: "org_123",
    organizationSlug: "acme/global",
    userId: "user:42"
  };

  it("uses a stable user-agent workspace path", () => {
    const workspacePath = buildUserAgentWorkspacePath({
      rootPath: "/var/lib/agent-studio/sessions",
      actor,
      modeId: "sales/copilot"
    });

    expect(workspacePath).toBe(path.join(
      "/var/lib/agent-studio/sessions",
      "acme_global",
      "user_42",
      "agent-sales_copilot"
    ));
    expect(isUserAgentWorkspacePath({
      rootPath: "/var/lib/agent-studio/sessions",
      actor,
      modeId: "sales/copilot",
      workspacePath
    })).toBe(true);
  });

  it("uses a stable integration-agent workspace path", () => {
    const workspacePath = buildIntegrationAgentWorkspacePath({
      rootPath: "/var/lib/agent-studio/sessions",
      provider: "openai-compatible/api",
      integrationInstanceId: "instance:42",
      modeId: "support/copilot"
    });

    expect(workspacePath).toBe(path.join(
      "/var/lib/agent-studio/sessions",
      "integrations",
      "openai-compatible_api",
      "instance_42",
      "agent-support_copilot"
    ));
    expect(isIntegrationAgentWorkspacePath({
      rootPath: "/var/lib/agent-studio/sessions",
      provider: "openai-compatible/api",
      integrationInstanceId: "instance:42",
      modeId: "support/copilot",
      workspacePath
    })).toBe(true);
  });

  it("does not change CODEX_HOME scope for per-thread directories or runtime-only metadata", () => {
    const base = buildSharedCodexHomeScope({
      actor,
      modeId: "support",
      codexRunConfig: {
        mode: "support",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: true,
        enabledSkills: [{ id: "crm", name: "crest-crm", sourcePath: "/skills/crm" }],
        additionalDirectories: ["/tmp/thread-a/uploads"],
        _agentStudioRuntimeCapabilities: { reason: "runtime only" }
      }
    });
    const changedThreadDirectory = buildSharedCodexHomeScope({
      actor,
      modeId: "support",
      codexRunConfig: {
        mode: "support",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: true,
        enabledSkills: [{ id: "crm", name: "crest-crm", sourcePath: "/skills/crm" }],
        additionalDirectories: ["/tmp/thread-b/uploads"],
        _agentStudioRuntimeCapabilities: { reason: "changed runtime only" }
      }
    });

    expect(changedThreadDirectory.capabilityHash).toBe(base.capabilityHash);
    expect(changedThreadDirectory.scopeSegments).toEqual(base.scopeSegments);
  });

  it("changes CODEX_HOME scope when agent capabilities change", () => {
    const crmOnly = buildSharedCodexHomeScope({
      actor,
      modeId: "support",
      codexRunConfig: {
        enabledSkills: [{ id: "crm", name: "crest-crm", sourcePath: "/skills/crm" }]
      }
    });
    const crmAndDocs = buildSharedCodexHomeScope({
      actor,
      modeId: "support",
      codexRunConfig: {
        enabledSkills: [
          { id: "docs", name: "docs", sourcePath: "/skills/docs" },
          { id: "crm", name: "crest-crm", sourcePath: "/skills/crm" }
        ]
      }
    });

    expect(crmAndDocs.capabilityHash).not.toBe(crmOnly.capabilityHash);
    expect(crmAndDocs.scopeSegments).not.toEqual(crmOnly.scopeSegments);
  });

  it("builds shared integration CODEX_HOME scopes without ticket-specific paths", () => {
    const support = buildSharedIntegrationCodexHomeScope({
      provider: "zendesk",
      integrationInstanceId: "instance/1",
      modeId: "support",
      codexRunConfig: {
        mode: "support",
        additionalDirectories: ["/var/lib/agent-studio/sessions/zendesk/instance-1/tickets/ticket-100"]
      }
    });
    const anotherTicket = buildSharedIntegrationCodexHomeScope({
      provider: "zendesk",
      integrationInstanceId: "instance/1",
      modeId: "support",
      codexRunConfig: {
        mode: "support",
        additionalDirectories: ["/var/lib/agent-studio/sessions/zendesk/instance-1/tickets/ticket-200"]
      }
    });

    expect(support.scopeSegments.slice(0, 3)).toEqual(["integrations", "zendesk", "instance_1"]);
    expect(anotherTicket.scopeSegments).toEqual(support.scopeSegments);
  });
});
