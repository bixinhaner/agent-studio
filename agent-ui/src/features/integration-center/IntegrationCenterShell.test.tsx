import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  createIntegrationInstance: vi.fn(),
  fetchIntegrationDetail: vi.fn(),
  fetchIntegrationInstances: vi.fn()
}));

vi.mock("./DingTalkIntegrationView", () => ({
  DingTalkIntegrationView: (props: { instanceId: string }) => <section>DingTalk detail {props.instanceId}</section>
}));

vi.mock("./ZendeskIntegrationView", () => ({
  ZendeskIntegrationView: (props: { detail: { instance: { id: string } } }) => <section>Zendesk detail {props.detail.instance.id}</section>
}));

vi.mock("./OpenAICodexIntegrationView", () => ({
  OpenAICodexIntegrationView: (props: { detail: { instance: { id: string } } }) => (
    <section>OpenAI detail {props.detail.instance.id}</section>
  )
}));

import { createIntegrationInstance, fetchIntegrationDetail, fetchIntegrationInstances } from "./api";
import { IntegrationCenterShell } from "./IntegrationCenterShell";
import type { IntegrationDetail, IntegrationListResponse } from "./types";

const mockedCreateIntegrationInstance = vi.mocked(createIntegrationInstance);
const mockedFetchIntegrationDetail = vi.mocked(fetchIntegrationDetail);
const mockedFetchIntegrationInstances = vi.mocked(fetchIntegrationInstances);

function makeListResponse(type: "dingtalk" | "zendesk" | "openai_codex", id: string, name: string): IntegrationListResponse {
  return {
    items: [
      {
        id,
        type,
        slug: `${type}-main`,
        name,
        description: `${name} description`,
        status: "active",
        isSystemSingleton: type !== "zendesk",
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z",
        secretState: {
          hasSecrets: type !== "zendesk"
        }
      }
    ]
  };
}

function makeDetail(type: "dingtalk" | "zendesk" | "openai_codex", id: string, name: string): IntegrationDetail {
  return {
    instance: makeListResponse(type, id, name).items[0],
    config: {},
    secretState: {
      hasSecrets: type !== "zendesk"
    },
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

describe("IntegrationCenterShell", () => {
  beforeEach(() => {
    mockedCreateIntegrationInstance.mockReset();
    mockedFetchIntegrationDetail.mockReset();
    mockedFetchIntegrationInstances.mockReset();

    mockedFetchIntegrationInstances.mockImplementation(async (type) => {
      if (type === "dingtalk") return makeListResponse("dingtalk", "int-ding-1", "Corp Main");
      if (type === "zendesk") return makeListResponse("zendesk", "int-zd-1", "Zendesk Main");
      return makeListResponse("openai_codex", "int-openai-1", "OpenAI Main");
    });

    mockedFetchIntegrationDetail.mockImplementation(async (instanceId) => {
      if (instanceId === "int-ding-1") return makeDetail("dingtalk", instanceId, "Corp Main");
      if (instanceId === "int-zd-1") return makeDetail("zendesk", instanceId, "Zendesk Main");
      if (instanceId === "int-zd-2") return makeDetail("zendesk", instanceId, "Zendesk Secondary");
      return makeDetail("openai_codex", instanceId, "OpenAI Main");
    });
  });

  it("switches between integration types and renders the corresponding detail view", async () => {
    render(<IntegrationCenterShell />);

    expect(await screen.findByText("DingTalk detail int-ding-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Zendesk" }));
    expect(await screen.findByText("Zendesk detail int-zd-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "OpenAI-Codex" }));
    expect(await screen.findByText("OpenAI detail int-openai-1")).toBeTruthy();
  });

  it("creates an instance for the active type and selects the returned detail", async () => {
    mockedCreateIntegrationInstance.mockResolvedValue(makeDetail("zendesk", "int-zd-2", "Zendesk Secondary"));

    render(<IntegrationCenterShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "Zendesk" }));
    fireEvent.click(screen.getByRole("button", { name: "新建实例" }));
    fireEvent.change(screen.getByLabelText("实例名称"), { target: { value: "Zendesk Secondary" } });
    fireEvent.change(screen.getByLabelText("实例 slug"), { target: { value: "zendesk-secondary" } });
    fireEvent.click(screen.getByRole("button", { name: "创建实例" }));

    await waitFor(() => {
      expect(mockedCreateIntegrationInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "zendesk",
          name: "Zendesk Secondary",
          slug: "zendesk-secondary"
        })
      );
    });
    const selectedItem = await screen.findByRole("button", { name: /Zendesk Secondary/ });
    expect(selectedItem.className).toContain("active");
  });
});
