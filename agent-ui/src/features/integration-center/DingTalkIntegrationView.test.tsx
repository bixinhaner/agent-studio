import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchIntegrationDetail: vi.fn(),
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

import { fetchIntegrationDetail, updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { DingTalkIntegrationView } from "./DingTalkIntegrationView";
import type { IntegrationDetail } from "./types";

const mockedFetchIntegrationDetail = vi.mocked(fetchIntegrationDetail);
const mockedUpdateIntegrationInstance = vi.mocked(updateIntegrationInstance);
const mockedValidateIntegrationInstance = vi.mocked(validateIntegrationInstance);

function makeDetail(): IntegrationDetail {
  return {
    instance: {
      id: "int-ding-1",
      type: "dingtalk",
      slug: "corp-main",
      name: "Corp Main",
      description: "primary",
      status: "active",
      isSystemSingleton: true,
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z",
      secretState: { hasSecrets: true }
    },
    config: {
      clientId: "ding-client-id",
      redirectUri: "https://agent.example.com/auth/dingtalk/callback",
      scope: "openid",
      alertAgentId: "agent-1",
      alertUserIds: ["user-a", "user-b"]
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

describe("DingTalkIntegrationView", () => {
  beforeEach(() => {
    mockedFetchIntegrationDetail.mockReset();
    mockedUpdateIntegrationInstance.mockReset();
    mockedValidateIntegrationInstance.mockReset();
    mockedFetchIntegrationDetail.mockResolvedValue(makeDetail());
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

  it("renders saved-secret state without exposing the secret value", async () => {
    render(<DingTalkIntegrationView instanceId="int-ding-1" />);

    expect(await screen.findByText("已保存密钥")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "配置" }));
    const secretInput = await screen.findByLabelText("Client Secret");
    expect(screen.queryByDisplayValue("ding-client-secret")).toBeNull();
    expect(secretInput.getAttribute("placeholder")).toBe("已保存密钥");
  });

  it("saves and validates the integration", async () => {
    const onInstanceUpdated = vi.fn();
    render(<DingTalkIntegrationView instanceId="int-ding-1" onInstanceUpdated={onInstanceUpdated} />);

    await screen.findByText("DingTalk");

    fireEvent.click(screen.getByRole("button", { name: "保存集成" }));
    await waitFor(() => {
      expect(mockedUpdateIntegrationInstance).toHaveBeenCalledWith(
        "int-ding-1",
        expect.objectContaining({
          name: "Corp Main",
          config: expect.objectContaining({
            clientId: "ding-client-id"
          })
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "验证连接" }));
    await waitFor(() => {
      expect(mockedValidateIntegrationInstance).toHaveBeenCalledWith("int-ding-1");
    });
    expect(onInstanceUpdated).toHaveBeenCalled();
  });
});
