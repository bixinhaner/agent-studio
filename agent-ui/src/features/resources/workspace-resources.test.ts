import { describe, expect, it } from "vitest";

import { resolvePortalWorkspaceResources } from "./workspace-resources";

describe("resolvePortalWorkspaceResources", () => {
  it("matches portal resources using workspace id", () => {
    const selected = resolvePortalWorkspaceResources(
      [
        {
          id: "ws-docs",
          label: "Docs",
          slug: "docs",
          is_default: true,
          runtime_workspace_path: "/workspace/default",
          default_knowledge_sets: [{ id: "ks-faq", label: "FAQ", slug: "faq" }],
          optional_knowledge_sets: [{ id: "ks-runbook", label: "Runbooks", slug: "runbooks" }]
        }
      ],
      "ws-docs"
    );

    expect(selected?.id).toBe("ws-docs");
    expect(selected?.default_knowledge_sets).toEqual([
      { id: "ks-faq", label: "FAQ", slug: "faq" }
    ]);
  });
});
