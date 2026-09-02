import { describe, expect, it, vi } from "vitest";

import { EnterpriseContextService, applyEnterpriseContextToPrompt } from "./enterprise-context-service.js";
import { createDefaultSystemSettingsPayload } from "./system-settings/types.js";

function enabledSettings() {
  return {
    ...createDefaultSystemSettingsPayload().enterpriseContext,
    enabled: true
  };
}

describe("EnterpriseContextService", () => {
  it("skips injection when the published setting is disabled", async () => {
    const service = new EnterpriseContextService({
      db: { user: { findUnique: vi.fn() } },
      getSettings: async () => createDefaultSystemSettingsPayload().enterpriseContext
    });

    await expect(service.resolveForRun({
      channel: "portal",
      userId: "user-1",
      agentModeId: "agent-1"
    })).resolves.toMatchObject({
      enabled: false,
      reason: "enterprise_context_disabled"
    });
  });

  it("builds a sanitized enterprise context block for a user", async () => {
    const findUnique = vi.fn(async (args: any) => {
      if (args.where?.id === "manager-1") {
        return { displayName: "Manager Li", email: "manager@example.com" };
      }
      return {
        id: "user-1",
        displayName: "Yong Ding",
        email: "dingyong@example.com",
        primaryOrganization: { name: "Internal Organization", slug: "internal" },
        enterpriseProfile: {
          title: "Support Engineer",
          employeeNo: "E1001",
          mobile: "13900000000",
          telephone: "010-12345678",
          workPlace: "Xi'an",
          managerUserId: "manager-1",
          lastSyncedAt: new Date("2026-06-14T01:02:03.000Z")
        },
        departmentMemberships: [
          {
            isPrimary: true,
            position: "Technical Support",
            isLeader: false,
            department: { name: "Technical Support" }
          }
        ]
      };
    });
    const service = new EnterpriseContextService({
      db: { user: { findUnique } },
      getSettings: async () => enabledSettings(),
      now: () => new Date("2026-06-14T02:03:04.000Z")
    });

    const result = await service.resolveForRun({
      channel: "portal",
      userId: "user-1",
      agentModeId: "agent-1"
    });

    expect(result.enabled).toBe(true);
    expect(result.markdown).toContain("<enterprise_context>");
    expect(result.markdown).toContain("Current user:");
    expect(result.markdown).toContain("- Name: Yong Ding");
    expect(result.markdown).toContain("- Direct manager: Manager Li");
    expect(result.markdown).toContain("Primary department");
    expect(result.markdown).toContain("Yong Ding");
    expect(result.markdown).toContain("Technical Support");
    expect(result.markdown).toContain("Manager Li");
    expect(result.markdown).not.toContain("user-1");
    expect(result.markdown).not.toContain("manager-1");
    expect(result.markdown).not.toContain("13900000000");
  });

  it("caches published user context for repeated runtime requests", async () => {
    const findUnique = vi.fn(async () => ({
      id: "user-1",
      displayName: "Yong Ding",
      email: "dingyong@example.com",
      primaryOrganization: { name: "Internal Organization" },
      enterpriseProfile: null,
      departmentMemberships: []
    }));
    const service = new EnterpriseContextService({
      db: { user: { findUnique } },
      getSettings: async () => enabledSettings(),
      now: () => new Date("2026-06-14T02:03:04.000Z")
    });

    await service.resolveForRun({ channel: "portal", userId: "user-1", agentModeId: "agent-1" });
    await service.resolveForRun({ channel: "portal", userId: "user-1", agentModeId: "agent-1" });

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("prepends the block without changing the original prompt body", () => {
    expect(applyEnterpriseContextToPrompt("hello", {
      enabled: true,
      markdown: "<enterprise_context>ctx</enterprise_context>"
    })).toBe("<enterprise_context>ctx</enterprise_context>\n\nhello");
  });
});
