import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  updateIntegrationInstance: vi.fn(),
  validateIntegrationInstance: vi.fn()
}));

vi.mock("./IntegrationBindingsEditor", () => ({
  IntegrationBindingsEditor: () => <div>bindings-editor</div>
}));

vi.mock("./IntegrationPolicyEditor", () => ({
  IntegrationPolicyEditor: () => <div>policy-editor</div>
}));

vi.mock("./IntegrationValidationHistory", () => ({
  IntegrationValidationHistory: () => <div>validation-history</div>
}));

import { updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { ZendeskIntegrationView } from "./ZendeskIntegrationView";
import type { IntegrationDetail } from "./types";

const mockedUpdateIntegrationInstance = vi.mocked(updateIntegrationInstance);
const mockedValidateIntegrationInstance = vi.mocked(validateIntegrationInstance);

function makeDetail(): IntegrationDetail {
  return {
    instance: {
      id: "int-zd-1",
      type: "zendesk",
      slug: "zendesk-main",
      name: "Zendesk Main",
      description: "primary",
      status: "active",
      isSystemSingleton: false,
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z",
      secretState: { hasSecrets: true }
    },
    config: {
      enabled: true,
      publicBaseUrl: "https://agent.example.com",
      zendeskBaseUrl: "https://example.zendesk.com",
      zendeskEmail: "ops@example.com",
      responseMode: "public_reply",
      fallbackMode: "internal_note",
      autoStatus: "pending",
      excludedTags: ["low-priority"],
      workspace: "/workspace",
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "live",
      additionalDirectories: ["/docs"],
      maxCommentHistory: 12,
      systemPrompt: "be concise"
    },
    secretState: { hasSecrets: true, rotatedAt: "2026-03-30T00:00:00.000Z", rotatedByUserId: "admin-1" },
    validationHistory: { items: [] },
    bindings: { items: [] },
    policies: {
      items: [],
      summary: {
        allow: { roles: [], departments: [], users: [] },
        deny: { roles: [], departments: [], users: [] }
      }
    }
  };
}

describe("ZendeskIntegrationView", () => {
  beforeEach(() => {
    mockedUpdateIntegrationInstance.mockReset();
    mockedValidateIntegrationInstance.mockReset();
    mockedUpdateIntegrationInstance.mockResolvedValue(makeDetail());
    mockedValidateIntegrationInstance.mockResolvedValue({
      validation: {
        id: "validation-1",
        triggerType: "manual",
        status: "success",
        createdAt: "2026-03-30T00:00:00.000Z"
      },
      detail: makeDetail()
    });
  });

  it("renders saved-secret state without exposing token values", () => {
    render(<ZendeskIntegrationView detail={makeDetail()} onUpdated={vi.fn()} />);

    expect(screen.getByText("已保存 Zendesk 凭证")).toBeTruthy();
    expect((screen.getByLabelText("Zendesk API Token") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Webhook Secret") as HTMLInputElement).value).toBe("");
    expect(screen.queryByDisplayValue("zendesk-api-token")).toBeNull();
    expect(screen.getByLabelText("Zendesk API Token").getAttribute("placeholder")).toBe("留空则保持现状");
  });

  it("saves and validates the zendesk integration", async () => {
    const onUpdated = vi.fn();
    render(<ZendeskIntegrationView detail={makeDetail()} onUpdated={onUpdated} />);

    fireEvent.click(screen.getByRole("button", { name: "保存实例" }));
    await waitFor(() => {
      expect(mockedUpdateIntegrationInstance).toHaveBeenCalledWith(
        "int-zd-1",
        expect.objectContaining({
          name: "Zendesk Main",
          config: expect.objectContaining({
            zendeskBaseUrl: "https://example.zendesk.com"
          })
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "验证实例" }));
    await waitFor(() => {
      expect(mockedValidateIntegrationInstance).toHaveBeenCalledWith("int-zd-1");
    });
    expect(onUpdated).toHaveBeenCalled();
  });
});
