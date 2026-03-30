import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillPackageItemEditor } from "./SkillPackageItemEditor";
import type { SkillPackageItemInput } from "./types";

describe("SkillPackageItemEditor", () => {
  it("adds, edits, and removes structured skill-package rows with multiple runtime bindings", () => {
    const onChange = vi.fn();
    const items: SkillPackageItemInput[] = [
      {
        capabilityKey: "ticket.search",
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
            bindingPayload: { prompt: "search tickets" }
          }
        ]
      }
    ];

    render(<SkillPackageItemEditor items={items} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("capability_key 1"), { target: { value: "ticket.reply" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        capabilityKey: "ticket.reply"
      })
    ]);

    fireEvent.change(screen.getByLabelText("runtime 1"), { target: { value: "claude_code" } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        runtimeBindings: [
          expect.objectContaining({ runtimeType: "claude_code" }),
          expect.objectContaining({ runtimeType: "claude_code", bindingType: "prompt_hint" })
        ]
      })
    ]);

    fireEvent.change(screen.getByLabelText("binding 1-2"), { target: { value: "{\"prompt\":\"search tickets quickly\"}" } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        runtimeBindings: [
          expect.any(Object),
          expect.objectContaining({ bindingPayload: { prompt: "search tickets quickly" } })
        ]
      })
    ]);

    fireEvent.click(screen.getByRole("button", { name: "新增运行绑定 1" }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        runtimeBindings: [
          expect.any(Object),
          expect.any(Object),
          expect.objectContaining({ runtimeType: "codex", bindingType: "config_fragment" })
        ]
      })
    ]);

    fireEvent.click(screen.getByRole("button", { name: "删除运行绑定 1-2" }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        runtimeBindings: [expect.any(Object)]
      })
    ]);

    fireEvent.click(screen.getByRole("button", { name: "新增能力项" }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.any(Object),
      expect.objectContaining({
        capabilityKey: "",
        runtimeBindings: [expect.objectContaining({ runtimeType: "codex" })]
      })
    ]);

    fireEvent.click(screen.getByRole("button", { name: "删除能力项 1" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
