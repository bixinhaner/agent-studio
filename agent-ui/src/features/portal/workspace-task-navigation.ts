export type StartWorkspaceTaskActions = {
  prepareForSwitch: () => void;
  showTask: () => void;
  showFolder: () => void;
  writeFolderLocation: (folderId: string, mode: "push" | "replace") => void;
  switchToNewThread: () => Promise<void>;
  reportError: (error: unknown) => void;
};

export async function startWorkspaceTaskInFolder(
  folderId: string,
  actions: StartWorkspaceTaskActions
): Promise<boolean> {
  actions.prepareForSwitch();
  actions.writeFolderLocation(folderId, "push");

  try {
    await actions.switchToNewThread();
    actions.showTask();
    return true;
  } catch (error) {
    actions.showFolder();
    actions.writeFolderLocation(folderId, "replace");
    actions.reportError(error);
    return false;
  }
}
