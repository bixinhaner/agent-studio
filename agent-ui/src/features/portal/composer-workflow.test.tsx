import { act, renderHook } from "@testing-library/react";
import { useCallback } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePortalComposerDraftPersistence, usePortalComposerWorkflowController } from "./composer-workflow";

describe("portal composer workflow controller", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("queues, reorders, edits, removes, and restores instructions", () => {
    const { result } = renderHook(() =>
      usePortalComposerWorkflowController({
        userId: "user-1",
        activeThreadId: "thread-1",
        onSteer: vi.fn()
      })
    );

    act(() => {
      result.current.contextValue.enqueue("first");
      result.current.contextValue.enqueue("second");
    });
    const [first, second] = result.current.contextValue.queue;

    act(() => result.current.contextValue.moveItem(second.id, -1));
    expect(result.current.contextValue.queue.map((item) => item.text)).toEqual(["second", "first"]);

    act(() => result.current.contextValue.updateItem(first.id, "edited first"));
    expect(result.current.contextValue.queue.map((item) => item.text)).toEqual(["second", "edited first"]);

    let removed: ReturnType<typeof result.current.contextValue.removeItem> = null;
    act(() => {
      removed = result.current.contextValue.removeItem(second.id);
    });
    expect(result.current.contextValue.queue.map((item) => item.text)).toEqual(["edited first"]);

    act(() => {
      if (removed) result.current.contextValue.restoreItem(removed);
    });
    expect(result.current.contextValue.queue.map((item) => item.text)).toEqual(["second", "edited first"]);
  });

  it("steers the active turn and removes the steered queued instruction", async () => {
    const onSteer = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePortalComposerWorkflowController({
        userId: "user-1",
        activeThreadId: "thread-1",
        onSteer
      })
    );

    act(() => result.current.contextValue.enqueue("focus on tests"));
    const queuedItem = result.current.contextValue.queue[0];
    await act(async () => {
      await result.current.contextValue.steer(queuedItem.text, queuedItem.id);
    });

    expect(onSteer).toHaveBeenCalledWith("focus on tests");
    expect(result.current.contextValue.queue).toEqual([]);
    expect(result.current.contextValue.steerNotice).toBe("focus on tests");
  });

  it("keeps the explicit interruption recovery state when the stream subsequently finishes", () => {
    const { result } = renderHook(() =>
      usePortalComposerWorkflowController({
        userId: "user-1",
        activeThreadId: "thread-1",
        onSteer: vi.fn()
      })
    );

    act(() => {
      const item = result.current.contextValue.enqueue("currently dispatching");
      result.current.contextValue.enqueue("queued after stop");
      result.current.contextValue.beginDispatch(item.id);
      result.current.markInterrupted("thread-1");
      result.current.markRunCompleted("thread-1");
    });

    expect(result.current.contextValue.pausedReason).toBe("interrupted");
    expect(result.current.contextValue.queue.map((item) => item.text)).toEqual(["queued after stop"]);
  });

  it("unpauses the queue when its failed instruction is removed", () => {
    const { result } = renderHook(() =>
      usePortalComposerWorkflowController({
        userId: "user-1",
        activeThreadId: "thread-1",
        onSteer: vi.fn()
      })
    );

    act(() => {
      const item = result.current.contextValue.enqueue("will fail");
      result.current.contextValue.beginDispatch(item.id);
      result.current.markRunFailed("thread-1");
    });
    expect(result.current.contextValue.pausedReason).toBe("failed");

    act(() => result.current.markRunCompleted("thread-1"));
    expect(result.current.contextValue.pausedReason).toBe("failed");

    act(() => result.current.contextValue.clearPause());
    expect(result.current.contextValue.pausedReason).toBe("failed");

    act(() => result.current.contextValue.removeItem(result.current.contextValue.queue[0].id));
    expect(result.current.contextValue.pausedReason).toBeNull();
    expect(result.current.contextValue.queue).toEqual([]);
  });

  it("flushes the previous thread text instead of the next thread text during a switch", () => {
    const drafts: Record<string, string> = { "thread-a": "", "thread-b": "" };
    const restoreText = vi.fn();
    const { rerender } = renderHook(
      ({ threadId, text }: { threadId: string; text: string }) => {
        const readDraft = useCallback(() => drafts[threadId] ?? "", [threadId]);
        const writeDraft = useCallback((value: string) => {
          drafts[threadId] = value;
        }, [threadId]);
        usePortalComposerDraftPersistence({ text, threadId, readDraft, writeDraft, restoreText });
      },
      { initialProps: { threadId: "thread-a", text: "" } }
    );

    act(() => rerender({ threadId: "thread-a", text: "draft for A" }));
    act(() => rerender({ threadId: "thread-b", text: "" }));

    expect(drafts["thread-a"]).toBe("draft for A");
    expect(drafts["thread-b"]).toBe("");

    act(() => rerender({ threadId: "thread-b", text: "draft before closing" }));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(drafts["thread-b"]).toBe("draft before closing");
  });
});
