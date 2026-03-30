import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  updateSkillPackage: vi.fn(),
  putSkillPackageItems: vi.fn(),
  putSkillPackageRuntimeBindings: vi.fn()
}));

vi.mock("./CapabilityPolicyEditor", () => ({
  CapabilityPolicyEditor: (props: { resourceType: string; resourceId: string }) => (
    <section>{`能力授权编辑器 ${props.resourceType} ${props.resourceId}`}</section>
  )
}));

import { putSkillPackageItems, putSkillPackageRuntimeBindings, updateSkillPackage } from "./api";
import { SkillPackageDetailView } from "./SkillPackageDetailView";
import type { SkillPackageRecord } from "./types";

const mockedUpdateSkillPackage = vi.mocked(updateSkillPackage);
const mockedPutSkillPackageItems = vi.mocked(putSkillPackageItems);
const mockedPutSkillPackageRuntimeBindings = vi.mocked(putSkillPackageRuntimeBindings);

const skillPackage: SkillPackageRecord = {
  id: "skill-package-1",
  organizationId: "org-1",
  name: "Support Tools",
  slug: "support-tools",
  description: "Default tools",
  status: "active",
  visibleToUsers: true,
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-30T00:00:00.000Z",
  items: [
    {
      id: "item-1",
      capabilityKey: "ticket.search",
      description: "Search tickets",
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z",
      runtimeBindings: [
        {
          id: "binding-1",
          runtimeType: "codex",
          bindingType: "config_fragment",
          bindingPayload: { tool: "ticket.search" },
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        },
        {
          id: "binding-2",
          runtimeType: "claude_code",
          bindingType: "prompt_hint",
          bindingPayload: { prompt: "search tickets" },
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    }
  ]
};

describe("SkillPackageDetailView", () => {
  beforeEach(() => {
    mockedUpdateSkillPackage.mockReset();
    mockedPutSkillPackageItems.mockReset();
    mockedPutSkillPackageRuntimeBindings.mockReset();
  });

  it("saves skill-package metadata, items, and runtime bindings", async () => {
    const onSkillPackageUpdated = vi.fn();

    mockedUpdateSkillPackage.mockResolvedValue({
      skillPackage: {
        ...skillPackage,
        name: "Support Tools Updated",
        slug: "support-tools-updated",
        description: "Updated tools",
        status: "disabled",
        visibleToUsers: false
      }
    });
    mockedPutSkillPackageItems.mockResolvedValue({
      skillPackage: {
        ...skillPackage,
        name: "Support Tools Updated",
        slug: "support-tools-updated",
        description: "Updated tools",
        status: "disabled",
        visibleToUsers: false,
        items: [
          {
            ...skillPackage.items[0],
            capabilityKey: "ticket.reply",
            runtimeBindings: [
              skillPackage.items[0].runtimeBindings[0],
              {
                ...skillPackage.items[0].runtimeBindings[1],
                bindingPayload: { prompt: "search tickets quickly" }
              }
            ]
          },
          {
            id: "item-2",
            capabilityKey: "ticket.comment",
            description: "Write comments",
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z",
            runtimeBindings: [
              {
                id: "binding-2",
                runtimeType: "claude_code",
                bindingType: "prompt_hint",
                bindingPayload: { prompt: "comment" },
                createdAt: "2026-03-30T00:00:00.000Z",
                updatedAt: "2026-03-30T00:00:00.000Z"
              },
              {
                id: "binding-3",
                runtimeType: "codex",
                bindingType: "config_fragment",
                bindingPayload: { tool: "ticket.comment" },
                createdAt: "2026-03-30T00:00:00.000Z",
                updatedAt: "2026-03-30T00:00:00.000Z"
              }
            ]
          }
        ]
      }
    });
    mockedPutSkillPackageRuntimeBindings.mockResolvedValue({
      skillPackage: {
        ...skillPackage,
        name: "Support Tools Updated",
        slug: "support-tools-updated",
        description: "Updated tools",
        status: "disabled",
        visibleToUsers: false,
        items: [
          {
            ...skillPackage.items[0],
            capabilityKey: "ticket.reply",
            runtimeBindings: [
              skillPackage.items[0].runtimeBindings[0],
              {
                ...skillPackage.items[0].runtimeBindings[1],
                bindingPayload: { prompt: "search tickets quickly" }
              }
            ]
          },
          {
            id: "item-2",
            capabilityKey: "ticket.comment",
            description: "Write comments",
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z",
            runtimeBindings: [
              {
                id: "binding-2",
                runtimeType: "claude_code",
                bindingType: "prompt_hint",
                bindingPayload: { prompt: "comment" },
                createdAt: "2026-03-30T00:00:00.000Z",
                updatedAt: "2026-03-30T00:00:00.000Z"
              },
              {
                id: "binding-3",
                runtimeType: "codex",
                bindingType: "config_fragment",
                bindingPayload: { tool: "ticket.comment" },
                createdAt: "2026-03-30T00:00:00.000Z",
                updatedAt: "2026-03-30T00:00:00.000Z"
              }
            ]
          }
        ]
      }
    });

    render(<SkillPackageDetailView skillPackage={skillPackage} onSkillPackageUpdated={onSkillPackageUpdated} />);

    fireEvent.change(screen.getByLabelText("技能包名称"), { target: { value: "Support Tools Updated" } });
    fireEvent.change(screen.getByLabelText("技能包 slug"), { target: { value: "support-tools-updated" } });
    fireEvent.change(screen.getByLabelText("技能包描述"), { target: { value: "Updated tools" } });
    fireEvent.change(screen.getByLabelText("技能包状态"), { target: { value: "disabled" } });
    fireEvent.change(screen.getByLabelText("对用户可见"), { target: { value: "hidden" } });

    fireEvent.click(screen.getByRole("tab", { name: "绑定关系" }));
    fireEvent.change(screen.getByLabelText("capability_key 1"), { target: { value: "ticket.reply" } });
    fireEvent.change(screen.getByLabelText("binding 1-2"), { target: { value: "{\"prompt\":\"search tickets quickly\"}" } });
    fireEvent.click(screen.getByRole("button", { name: "新增能力项" }));
    fireEvent.change(screen.getByLabelText("capability_key 2"), { target: { value: "ticket.comment" } });
    fireEvent.change(screen.getByLabelText("description 2"), { target: { value: "Write comments" } });
    fireEvent.change(screen.getByLabelText("runtime 2"), { target: { value: "claude_code" } });
    fireEvent.change(screen.getByLabelText("binding_type 2"), { target: { value: "prompt_hint" } });
    fireEvent.change(screen.getByLabelText("binding 2"), { target: { value: "{\"prompt\":\"comment\"}" } });
    fireEvent.click(screen.getByRole("button", { name: "新增运行绑定 2" }));
    fireEvent.change(screen.getByLabelText("runtime 2-2"), { target: { value: "codex" } });
    fireEvent.change(screen.getByLabelText("binding_type 2-2"), { target: { value: "config_fragment" } });
    fireEvent.change(screen.getByLabelText("binding 2-2"), { target: { value: "{\"tool\":\"ticket.comment\"}" } });

    fireEvent.click(screen.getByRole("button", { name: "保存技能包" }));

    await waitFor(() => {
      expect(mockedUpdateSkillPackage).toHaveBeenCalledWith("skill-package-1", {
        name: "Support Tools Updated",
        slug: "support-tools-updated",
        description: "Updated tools",
        status: "disabled",
        visibleToUsers: false
      });
    });

    await waitFor(() => {
      expect(mockedPutSkillPackageItems).toHaveBeenCalledWith("skill-package-1", [
        {
          capabilityKey: "ticket.reply",
          description: "Search tickets",
          runtimeBindings: [
            {
              runtimeType: "codex",
              bindingType: "config_fragment",
              bindingPayload: { tool: "ticket.search" }
            },
            {
              runtimeType: "claude_code",
              bindingType: "prompt_hint",
              bindingPayload: { prompt: "search tickets quickly" }
            }
          ]
        },
        {
          capabilityKey: "ticket.comment",
          description: "Write comments",
          runtimeBindings: [
            {
              runtimeType: "claude_code",
              bindingType: "prompt_hint",
              bindingPayload: { prompt: "comment" }
            },
            {
              runtimeType: "codex",
              bindingType: "config_fragment",
              bindingPayload: { tool: "ticket.comment" }
            }
          ]
        }
      ]);
    });

    await waitFor(() => {
      expect(mockedPutSkillPackageRuntimeBindings).toHaveBeenCalledWith("skill-package-1", [
        {
          capabilityKey: "ticket.reply",
          description: "Search tickets",
          runtimeBindings: [
            {
              runtimeType: "codex",
              bindingType: "config_fragment",
              bindingPayload: { tool: "ticket.search" }
            },
            {
              runtimeType: "claude_code",
              bindingType: "prompt_hint",
              bindingPayload: { prompt: "search tickets quickly" }
            }
          ]
        },
        {
          capabilityKey: "ticket.comment",
          description: "Write comments",
          runtimeBindings: [
            {
              runtimeType: "claude_code",
              bindingType: "prompt_hint",
              bindingPayload: { prompt: "comment" }
            },
            {
              runtimeType: "codex",
              bindingType: "config_fragment",
              bindingPayload: { tool: "ticket.comment" }
            }
          ]
        }
      ]);
    });

    expect(onSkillPackageUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Support Tools Updated" }));
    expect(await screen.findByText("技能包已保存")).toBeTruthy();
  });

  it("renders authorization with the shared capability policy editor", async () => {
    render(<SkillPackageDetailView skillPackage={skillPackage} onSkillPackageUpdated={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "授权" }));

    expect(screen.getByText("能力授权编辑器 skill_package skill-package-1")).toBeTruthy();
  });
});
