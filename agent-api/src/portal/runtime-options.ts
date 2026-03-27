import path from "node:path";

export type PortalRuntimeOptions = {
  modes: Array<{
    id: string;
    label: string;
  }>;
  workspaces: Array<{
    id: string;
    label: string;
    isDefault: boolean;
  }>;
  canUpload: boolean;
  defaults: {
    mode: string;
    workspace: string;
  };
};

function workspaceLabel(root: string, index: number): string {
  const base = path.basename(root);
  if (base && base !== path.sep) {
    return base;
  }
  return `workspace-${index + 1}`;
}

export function derivePortalRuntimeOptions(input: {
  role?: string;
  workspaceRoots: string[];
  defaultWorkspace: string;
}): PortalRuntimeOptions {
  const modes =
    input.role === "admin" || input.role === "super_admin"
      ? [
          { id: "standard", label: "通用助手" },
          { id: "review", label: "复核助手" }
        ]
      : [{ id: "standard", label: "通用助手" }];
  const workspaces = input.workspaceRoots.map((root, index) => ({
    id: root,
    label: workspaceLabel(root, index),
    isDefault: root === input.defaultWorkspace
  }));
  const defaultWorkspace = workspaces.find((workspace) => workspace.isDefault)?.id ?? workspaces[0]?.id ?? input.defaultWorkspace;

  return {
    modes,
    workspaces,
    canUpload: true,
    defaults: {
      mode: modes[0]?.id ?? "standard",
      workspace: defaultWorkspace
    }
  };
}
