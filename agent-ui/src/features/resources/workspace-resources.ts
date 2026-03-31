import type { PortalWorkspaceResources } from "./types";

export function resolvePortalWorkspaceResources(
  workspaces: PortalWorkspaceResources[],
  workspaceIdentity: string
): PortalWorkspaceResources | undefined {
  const normalizedWorkspaceIdentity = workspaceIdentity.trim();
  if (!normalizedWorkspaceIdentity) return undefined;
  return (
    workspaces.find((workspace) => workspace.id === normalizedWorkspaceIdentity) ||
    workspaces.find((workspace) => workspace.runtime_workspace_path === normalizedWorkspaceIdentity)
  );
}
