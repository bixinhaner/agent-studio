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

export type ExistingTaskSwitchGate = { current: number };

export type SwitchToExistingTaskActions = {
  /** The requested task is already the active one, so nothing needs to be unmounted. */
  isActive: boolean;
  /** Synchronously unmount the current task's message tree. */
  unmountThreadView: () => void;
  switchToThread: () => Promise<void>;
  remountThreadView: () => void;
  reportError: (error: unknown) => void;
};

/**
 * Opens an existing task without leaving the previous task's messages mounted while the
 * assistant runtime is replaced. Mounted message views read their message by index, so
 * switching underneath them can make React render an index the new task does not have.
 * Only the most recent switch remounts the view when several switches overlap.
 */
export async function switchToExistingWorkspaceTask(
  gate: ExistingTaskSwitchGate,
  actions: SwitchToExistingTaskActions
): Promise<boolean> {
  if (actions.isActive) {
    try {
      await actions.switchToThread();
      return true;
    } catch (error) {
      actions.reportError(error);
      return false;
    }
  }

  gate.current += 1;
  const switchId = gate.current;
  actions.unmountThreadView();
  try {
    await actions.switchToThread();
    return true;
  } catch (error) {
    actions.reportError(error);
    return false;
  } finally {
    if (gate.current === switchId) actions.remountThreadView();
  }
}
