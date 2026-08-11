import { describe, expect, it, vi } from "vitest";

import { startWorkspaceTaskInFolder, type StartWorkspaceTaskActions } from "./workspace-task-navigation";

function navigationActions(events: string[], switchToNewThread = vi.fn(async () => undefined)) {
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
