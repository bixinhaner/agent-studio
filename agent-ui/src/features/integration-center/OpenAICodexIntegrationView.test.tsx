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
import { OpenAICodexIntegrationView } from "./OpenAICodexIntegrationView";
import type { IntegrationDetail } from "./types";

const mockedUpdateIntegrationInstance = vi.mocked(updateIntegrationInstance);
const mockedValidateIntegrationInstance = vi.mocked(validateIntegrationInstance);

function makeDetail(): IntegrationDetail {
  return {
    instance: {
      id: "int-openai-1",
      type: "openai_codex",
      slug: "openai-main",
      name: "OpenAI Main",
      description: "provider",
      status: "active",
      isSystemSingleton: true,
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z",
      secretState: { hasSecrets: true }
    },
    config: {
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4-mini",
      defaultReasoningEffort: "medium"
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

describe("OpenAICodexIntegrationView", () => {
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

  it("renders saved-secret state without exposing api key values", () => {
    render(<OpenAICodexIntegrationView detail={makeDetail()} onUpdated={vi.fn()} />);

    expect(screen.getByText("已保存 API key")).toBeTruthy();
    expect(screen.queryByDisplayValue(/sk-/)).toBeNull();
    expect(screen.getByLabelText("API Key").getAttribute("placeholder")).toBe("留空则保持现状");
  });

  it("saves and validates the openai codex integration", async () => {
    const onUpdated = vi.fn();
    render(<OpenAICodexIntegrationView detail={makeDetail()} onUpdated={onUpdated} />);

    fireEvent.click(screen.getByRole("button", { name: "保存实例" }));
    await waitFor(() => {
      expect(mockedUpdateIntegrationInstance).toHaveBeenCalledWith(
        "int-openai-1",
        expect.objectContaining({
          config: expect.objectContaining({
            defaultModel: "gpt-5.4-mini"
          })
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "验证连接" }));
    await waitFor(() => {
      expect(mockedValidateIntegrationInstance).toHaveBeenCalledWith("int-openai-1");
    });
    expect(onUpdated).toHaveBeenCalled();
  });
});
