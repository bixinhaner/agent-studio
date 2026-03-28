import type { PortalWorkspaceResources } from "./types";

export function resolvePortalWorkspaceResources(
  workspaces: PortalWorkspaceResources[],
  runtimeWorkspacePath: string
): PortalWorkspaceResources | undefined {
  const normalizedRuntimePath = runtimeWorkspacePath.trim();
  if (!normalizedRuntimePath) return undefined;
  return workspaces.find((workspace) => workspace.runtime_workspace_path === normalizedRuntimePath);
}
