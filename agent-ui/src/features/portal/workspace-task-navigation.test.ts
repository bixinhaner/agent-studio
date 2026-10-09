import { describe, expect, it, vi } from "vitest";

import {
  startWorkspaceTaskInFolder,
  switchToExistingWorkspaceTask,
  type StartWorkspaceTaskActions,
  type SwitchToExistingTaskActions
} from "./workspace-task-navigation";

function navigationActions(events: string[], switchToNewThread: () => Promise<void> = vi.fn(async () => undefined)) {
  const actions: StartWorkspaceTaskActions = {
    prepareForSwitch: () => events.push("prepare-for-switch"),
    showTask: () => events.push("show-task"),
    showFolder: () => events.push("show-folder"),
    writeFolderLocation: (folderId, mode) => events.push(`write-location:${folderId}:${mode}`),
    switchToNewThread: async () => {
      events.push("switch-to-new-thread");
      await switchToNewThread();
    },
    reportError: (error) => events.push(`error:${error instanceof Error ? error.message : String(error)}`)
  };
  return actions;
}

describe("workspace task navigation", () => {
  it("switches the runtime before showing a new task in the selected folder", async () => {
    const events: string[] = [];

    await expect(startWorkspaceTaskInFolder("folder-target", navigationActions(events))).resolves.toBe(true);

    expect(events).toEqual([
      "prepare-for-switch",
      "write-location:folder-target:push",
      "switch-to-new-thread",
      "show-task"
    ]);
  });

  it("keeps the old message view unmounted while the runtime switch is pending", async () => {
    const events: string[] = [];
    let finishSwitch: (() => void) | undefined;
    const switchPending = new Promise<void>((resolve) => {
      finishSwitch = resolve;
    });

    const transition = startWorkspaceTaskInFolder(
      "folder-target",
      navigationActions(events, vi.fn(() => switchPending))
    );

    await Promise.resolve();
    expect(events).toEqual([
      "prepare-for-switch",
      "write-location:folder-target:push",
      "switch-to-new-thread"
    ]);

    finishSwitch?.();
    await expect(transition).resolves.toBe(true);
    expect(events.at(-1)).toBe("show-task");
  });

  it("returns to the selected folder when the new-thread transition fails", async () => {
    const events: string[] = [];
    const switchToNewThread = vi.fn(async () => {
      throw new Error("runtime unavailable");
    });

    await expect(
      startWorkspaceTaskInFolder("folder-target", navigationActions(events, switchToNewThread))
    ).resolves.toBe(false);

    expect(events).toEqual([
      "prepare-for-switch",
      "write-location:folder-target:push",
      "switch-to-new-thread",
      "show-folder",
      "write-location:folder-target:replace",
      "error:runtime unavailable"
    ]);
  });
});

describe("switchToExistingWorkspaceTask", () => {
  function createActions(overrides: Partial<SwitchToExistingTaskActions> = {}) {
    const calls: string[] = [];
    const actions: SwitchToExistingTaskActions = {
      isActive: false,
      unmountThreadView: () => calls.push("unmount"),
      switchToThread: async () => {
        calls.push("switch");
      },
      remountThreadView: () => calls.push("remount"),
      reportError: () => calls.push("error"),
      ...overrides
    };
    return { actions, calls };
  }

  it("unmounts the current messages before switching the runtime, then remounts", async () => {
    const { actions, calls } = createActions();

    await expect(switchToExistingWorkspaceTask({ current: 0 }, actions)).resolves.toBe(true);

    expect(calls).toEqual(["unmount", "switch", "remount"]);
  });

  it("does not unmount when the task is already open", async () => {
    const { actions, calls } = createActions({ isActive: true });

    await switchToExistingWorkspaceTask({ current: 0 }, actions);

    expect(calls).toEqual(["switch"]);
  });

  it("remounts and reports when the switch fails", async () => {
    const error = new Error("missing thread");
    const reportError = vi.fn();
    const { actions, calls } = createActions({
      switchToThread: async () => {
        throw error;
      },
      reportError
    });

    await expect(switchToExistingWorkspaceTask({ current: 0 }, actions)).resolves.toBe(false);

    expect(calls).toEqual(["unmount", "remount"]);
    expect(reportError).toHaveBeenCalledWith(error);
  });

  it("lets only the latest overlapping switch remount the view", async () => {
    const gate = { current: 0 };
    let finishFirst: () => void = () => undefined;
    const first = createActions({
      switchToThread: () => new Promise<void>((resolve) => {
        finishFirst = resolve;
      })
    });
    const second = createActions();

    const firstSwitch = switchToExistingWorkspaceTask(gate, first.actions);
    const secondSwitch = switchToExistingWorkspaceTask(gate, second.actions);
    finishFirst();
    await firstSwitch;
    await secondSwitch;

    expect(second.calls).toEqual(["unmount", "switch", "remount"]);
    expect(first.calls).toEqual(["unmount"]);
  });
});

  it("serializes runtime changes, skips obsolete queued targets and suppresses stale errors", async () => {
    const gate = { current: 0 };
    let release!: () => void;
    let active = "original";
    const selected: string[] = [];
    const error = vi.fn();
    const open = (id: string, wait?: Promise<void>) => switchToExistingWorkspaceTask(gate, {
      isActive: id === active,
      unmountThreadView: () => {},
      switchToThread: async () => { if (wait) await wait; active = id; },
      remountThreadView: () => selected.push(active), reportError: error
    });
    const first = open("slow", new Promise<void>(r => { release = r; }));
    const skipped = open("intermediate");
    const last = open("original");
    release();
    expect(await Promise.all([first, skipped, last])).toEqual([false, false, true]);
    expect(active).toBe("original");
    expect(selected).toEqual(["original"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("serializes new-task creation with an existing task and hides superseded completion", async () => {
    const gate = { current: 0 };
    const events: string[] = [];
    let finish!: () => void;
    const first = startWorkspaceTaskInFolder("folder", navigationActions(events, () => new Promise<void>(r => { finish = r; })), gate);
    const last = switchToExistingWorkspaceTask(gate, {
      isActive: false, unmountThreadView: () => {}, switchToThread: async () => { events.push("existing"); }, remountThreadView: () => {}, reportError: () => {}
    });
    finish();
    expect(await first).toBe(false);
    expect(await last).toBe(true);
    expect(events).not.toContain("show-task");
    expect(events.at(-1)).toBe("existing");
  });
