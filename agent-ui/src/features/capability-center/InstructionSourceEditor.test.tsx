import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { InstructionSourceEditor } from "./InstructionSourceEditor";
import type { AgentModeInstructionSourceInput } from "./types";
import type { WorkspaceRecord } from "../resources-center/types";

function Harness(props: {
  sources: AgentModeInstructionSourceInput[];
  workspaces: WorkspaceRecord[];
  onChange: (sources: AgentModeInstructionSourceInput[]) => void;
}) {
  const [sources, setSources] = useState(props.sources);
  return (
    <InstructionSourceEditor
      instructionSources={sources}
      workspaces={props.workspaces}
      onChange={(next) => {
        props.onChange(next);
        setSources(next);
      }}
    />
  );
}

describe("InstructionSourceEditor", () => {
  it("edits inline, workspace, and knowledge-set sources in order", async () => {
    const workspaces: WorkspaceRecord[] = [
      {
        id: "workspace-1",
        organizationId: "org-1",
        name: "Workspace A",
        slug: "workspace-a",
        description: "",
        status: "active",
        sourceType: "filesystem",
        rootPath: "/srv/workspace-a",
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      },
      {
        id: "workspace-2",
        organizationId: "org-1",
        name: "Workspace B",
        slug: "workspace-b",
        description: "",
        status: "active",
        sourceType: "filesystem",
        rootPath: "/srv/workspace-b",
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      }
    ];
    const sources: AgentModeInstructionSourceInput[] = [
      { sourceType: "inline_text", sourceRef: "Always write tests first.", sortOrder: 0 },
      { sourceType: "workspace_agents_md", sourceRef: "workspace-1", sortOrder: 1 }
    ];

    const onChange = vi.fn();

    render(<Harness sources={sources} workspaces={workspaces} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "新增指令源" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { sourceType: "inline_text", sourceRef: "Always write tests first.", sortOrder: 0 },
      { sourceType: "workspace_agents_md", sourceRef: "workspace-1", sortOrder: 1 },
      { sourceType: "inline_text", sourceRef: "", sortOrder: 2 }
    ]);

    fireEvent.change(screen.getByLabelText("来源类型 2"), { target: { value: "knowledge_set_document" } });
    fireEvent.change(screen.getByLabelText("来源引用 2"), { target: { value: "knowledge-set-1#/docs/intro.md" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { sourceType: "inline_text", sourceRef: "Always write tests first.", sortOrder: 0 },
      { sourceType: "knowledge_set_document", sourceRef: "knowledge-set-1#/docs/intro.md", sortOrder: 1 },
      { sourceType: "inline_text", sourceRef: "", sortOrder: 2 }
    ]);

    fireEvent.change(screen.getByLabelText("来源类型 1"), { target: { value: "workspace_agents_md" } });
    fireEvent.change(screen.getByLabelText("来源引用 1"), { target: { value: "workspace-2" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { sourceType: "workspace_agents_md", sourceRef: "workspace-2", sortOrder: 0 },
      { sourceType: "knowledge_set_document", sourceRef: "knowledge-set-1#/docs/intro.md", sortOrder: 1 },
      { sourceType: "inline_text", sourceRef: "", sortOrder: 2 }
    ]);

    fireEvent.click(screen.getByRole("button", { name: "下移 1" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { sourceType: "knowledge_set_document", sourceRef: "knowledge-set-1#/docs/intro.md", sortOrder: 0 },
      { sourceType: "workspace_agents_md", sourceRef: "workspace-2", sortOrder: 1 },
      { sourceType: "inline_text", sourceRef: "", sortOrder: 2 }
    ]);

    expect(screen.getByLabelText("来源引用 1")).toBeTruthy();
    expect(screen.getByLabelText("来源引用 2")).toBeTruthy();
    expect(screen.getByLabelText("来源引用 3")).toBeTruthy();
  });
});
