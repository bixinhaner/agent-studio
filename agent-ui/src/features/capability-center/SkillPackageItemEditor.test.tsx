import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillPackageItemEditor } from "./SkillPackageItemEditor";
import type { SkillPackageItemInput } from "./types";

describe("SkillPackageItemEditor", () => {
  it("adds, edits, and removes structured skill-package rows", () => {
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
        runtimeBindings: [expect.objectContaining({ runtimeType: "claude_code" })]
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
