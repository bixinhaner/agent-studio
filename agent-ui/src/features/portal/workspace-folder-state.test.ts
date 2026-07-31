import { describe, expect, it } from "vitest";

import { expandWorkspaceFolderIds } from "./workspace-folder-state";

describe("workspace folder state", () => {
  it("propagates a child state through every ancestor", () => {
    expect(
      Array.from(
        expandWorkspaceFolderIds(new Set(["child"]), {
          child: ["child", "parent", "root"]
        })
      )
    ).toEqual(["child", "parent", "root"]);
  });

  it("keeps direct states visible when an ancestor path is unavailable", () => {
    expect(Array.from(expandWorkspaceFolderIds(new Set(["folder"]), {}))).toEqual(["folder"]);
  });
});
