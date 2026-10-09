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
  actions: StartWorkspaceTaskActions,
  gate: ExistingTaskSwitchGate = { current: 0 }
): Promise<boolean> {
  return switchToExistingWorkspaceTask(gate, {
    isActive: false,
    unmountThreadView: () => {
      actions.prepareForSwitch();
      actions.writeFolderLocation(folderId, "push");
    },
    switchToThread: actions.switchToNewThread,
    remountThreadView: () => {},
    reportError: (error) => {
      actions.showFolder();
      actions.writeFolderLocation(folderId, "replace");
      actions.reportError(error);
    }
  }).then((selected) => {
    if (selected) actions.showTask();
    return selected;
  });
}

export type ExistingTaskSwitchGate = { current: number; tail?: Promise<boolean> };

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
 * Runtime mutations are serialized; superseded queued selections are skipped and only
 * the latest request remounts the view.
 */
export async function switchToExistingWorkspaceTask(
  gate: ExistingTaskSwitchGate,
  actions: SwitchToExistingTaskActions
): Promise<boolean> {
  const previous = gate.tail;
  const switchId = ++gate.current;
  const needsUnmount = !actions.isActive || Boolean(previous);
  if (needsUnmount) actions.unmountThreadView();
  const run = async () => {
    if (previous) await previous.catch(() => false);
    if (gate.current !== switchId) return false;
    try {
      await actions.switchToThread();
      return gate.current === switchId;
    } catch (error) {
      if (gate.current === switchId) actions.reportError(error);
      return false;
    } finally {
      if (gate.current === switchId && needsUnmount) actions.remountThreadView();
    }
  };
  // Reserve the queue before invoking runtime callbacks, including synchronous ones.
  let release!: (value: boolean) => void;
  const task = new Promise<boolean>((resolve) => { release = resolve; });
  gate.tail = task;
  void run().then(release, () => release(false));
  void task.then(() => { if (gate.tail === task) gate.tail = undefined; });
  return task;
}
