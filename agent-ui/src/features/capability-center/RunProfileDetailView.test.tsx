import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  updateRunProfile: vi.fn()
}));

vi.mock("./CapabilityPolicyEditor", () => ({
  CapabilityPolicyEditor: (props: { resourceType: string; resourceId: string }) => (
    <section>{`能力授权编辑器 ${props.resourceType} ${props.resourceId}`}</section>
  )
}));

import { updateRunProfile } from "./api";
import { RunProfileDetailView } from "./RunProfileDetailView";
import type { RunProfileRecord } from "./types";

const mockedUpdateRunProfile = vi.mocked(updateRunProfile);

const runProfile: RunProfileRecord = {
  id: "run-profile-1",
  organizationId: "org-1",
  name: "Coding Default",
  slug: "coding-default",
  description: "Default coding profile",
  status: "active",
  defaultModel: "gpt-5.4",
  allowedModels: ["gpt-5.4", "gpt-5.4-mini"],
  defaultReasoningEffort: "high",
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  networkAccessEnabled: true,
  webSearchMode: "live",
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-30T00:00:00.000Z"
};

describe("RunProfileDetailView", () => {
  beforeEach(() => {
    mockedUpdateRunProfile.mockReset();
  });

  it("saves run-profile policy fields from the basic tab", async () => {
    const onRunProfileUpdated = vi.fn();
    mockedUpdateRunProfile.mockResolvedValue({
      runProfile: {
        ...runProfile,
        name: "Coding Advanced",
        slug: "coding-advanced",
        description: "Updated description",
        status: "disabled",
        defaultModel: "gpt-5.4-mini",
        allowedModels: ["gpt-5.4-mini", "gpt-5.4"],
        defaultReasoningEffort: "medium",
        sandboxMode: "read-only",
        approvalPolicy: "on-request",
        networkAccessEnabled: false,
        webSearchMode: "cached"
      }
    });

    render(<RunProfileDetailView runProfile={runProfile} onRunProfileUpdated={onRunProfileUpdated} />);

    fireEvent.change(screen.getByLabelText("运行策略名称"), { target: { value: "Coding Advanced" } });
    fireEvent.change(screen.getByLabelText("运行策略 slug"), { target: { value: "coding-advanced" } });
    fireEvent.change(screen.getByLabelText("运行策略描述"), { target: { value: "Updated description" } });
    fireEvent.change(screen.getByLabelText("运行策略状态"), { target: { value: "disabled" } });
    fireEvent.change(screen.getByLabelText("默认模型"), { target: { value: "gpt-5.4-mini" } });
    fireEvent.change(screen.getByLabelText("可选模型"), { target: { value: "gpt-5.4-mini, gpt-5.4" } });
    fireEvent.change(screen.getByLabelText("推理强度"), { target: { value: "medium" } });
    fireEvent.change(screen.getByLabelText("沙箱模式"), { target: { value: "read-only" } });
    fireEvent.change(screen.getByLabelText("审批策略"), { target: { value: "on-request" } });
    fireEvent.change(screen.getByLabelText("联网"), { target: { value: "disabled" } });
    fireEvent.change(screen.getByLabelText("搜索模式"), { target: { value: "cached" } });

    fireEvent.click(screen.getByRole("button", { name: "保存运行策略" }));

    await waitFor(() => {
      expect(mockedUpdateRunProfile).toHaveBeenCalledWith("run-profile-1", {
        name: "Coding Advanced",
        slug: "coding-advanced",
        description: "Updated description",
        status: "disabled",
        defaultModel: "gpt-5.4-mini",
        allowedModels: ["gpt-5.4-mini", "gpt-5.4"],
        defaultReasoningEffort: "medium",
        sandboxMode: "read-only",
        approvalPolicy: "on-request",
        networkAccessEnabled: false,
        webSearchMode: "cached"
      });
    });

    expect(onRunProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Coding Advanced" }));
    expect(await screen.findByText("运行策略已保存")).toBeTruthy();
  });

  it("renders binding previews and authorization tab content", async () => {
    render(<RunProfileDetailView runProfile={runProfile} onRunProfileUpdated={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "绑定关系" }));
    expect(screen.getByText("目录策略预览")).toBeTruthy();
    expect(screen.getByText("AGENTS.md 预览")).toBeTruthy();
    expect(screen.getByText("指令预览")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "授权" }));
    expect(screen.getByText("能力授权编辑器 run_profile run-profile-1")).toBeTruthy();
  });
});
