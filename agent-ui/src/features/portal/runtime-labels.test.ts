import { describe, expect, it } from "vitest";

import { resolveModeLabel, resolveModeOptions, resolveWorkspaceLabel, resolveWorkspaceOptions } from "./runtime-labels";

describe("runtime label helpers", () => {
  it("hides raw mode ids when runtime options are unavailable", () => {
    expect(resolveModeLabel([], "standard")).toBe("通用助手");
    expect(resolveModeLabel([], "review")).toBe("复核助手");
    expect(resolveModeOptions([], "standard")).toEqual([{ id: "standard", label: "通用助手" }]);
  });

  it("returns the label for the currently selected mode", () => {
    const options = [
      { id: "standard", label: "通用助手" },
      { id: "review", label: "复核助手" }
    ];

    expect(resolveModeLabel(options, "review")).toBe("复核助手");
  });

  it("hides raw workspace ids when runtime options are unavailable", () => {
    expect(resolveWorkspaceLabel([], ".")).toBe("默认工作区");
    expect(resolveWorkspaceOptions([], ".")).toEqual([{ id: ".", label: "默认工作区", isDefault: true }]);
  });

  it("returns the label for the currently selected workspace", () => {
    const options = [
      { id: "/repo-a", label: "repo-a", isDefault: true },
      { id: "/repo-b", label: "repo-b", isDefault: false }
    ];

    expect(resolveWorkspaceLabel(options, "/repo-b")).toBe("repo-b");
  });
});
