import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  usePortalComposerDraftPersistence,
  usePortalComposerWorkflowController,
  type PortalSteerEvent
} from "./composer-workflow";

function acceptedSteerEvent(message: string, id = "portal-steer-test"): PortalSteerEvent {
  return {
    id,
    threadId: "thread-1",
    sessionId: "session-1",
    sourceUserMessageId: "user-message-1",
    turnId: "turn-1",
    message,
    status: "accepted",
    resolvedAt: "2026-08-09T08:00:01.000Z",
    createdAt: "2026-08-09T08:00:00.000Z",
    updatedAt: "2026-08-09T08:00:01.000Z"
  };
}

const unusedSteer = async (message: string, id: string) => acceptedSteerEvent(message, id);

describe("portal composer workflow controller", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("queues, reorders, edits, removes, and restores instructions", () => {
    const { result } = renderHook(() =>
      usePortalComposerWorkflowController({
        userId: "user-1",
        activeThreadId: "thread-1",
        onSteer: unusedSteer
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
    const onSteer = vi.fn(async (message: string, id: string) => acceptedSteerEvent(message, id));
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

    expect(onSteer).toHaveBeenCalledWith("focus on tests", expect.stringMatching(/^portal-steer-/));
    expect(result.current.contextValue.queue).toEqual([]);
    expect(result.current.contextValue.steerEvents).toEqual([
      expect.objectContaining({ message: "focus on tests", status: "accepted" })
    ]);
  });

  it("anchors an optimistic direction to the active user turn before the request resolves", async () => {
    let resolveSteer: ((event: PortalSteerEvent) => void) | undefined;
    const onSteer = vi.fn(
      (message: string, id: string) => new Promise<PortalSteerEvent>((resolve) => {
        resolveSteer = resolve;
      })
    );
    const { result } = renderHook(() =>
      usePortalComposerWorkflowController({
        userId: "user-1",
        activeThreadId: "thread-1",
        onSteer,
        getSteerSourceUserMessageId: () => "user-message-1"
      })
    );

    let request: Promise<PortalSteerEvent> | undefined;
    act(() => {
      request = result.current.contextValue.steer("focus on deployment cost");
    });
    expect(result.current.contextValue.steerEvents[0]).toMatchObject({
      sourceUserMessageId: "user-message-1",
      status: "pending"
    });

    await act(async () => {
      resolveSteer?.(acceptedSteerEvent("focus on deployment cost", result.current.contextValue.steerEvents[0].id));
      await request;
    });
    expect(result.current.contextValue.steerEvents[0]).toMatchObject({
      sourceUserMessageId: "user-message-1",
      status: "accepted"
    });
  });

  it("keeps a failed direction visible and retries it with the same client id", async () => {
    const onSteer = vi
      .fn<(message: string, id: string) => Promise<PortalSteerEvent>>()
      .mockRejectedValueOnce(new Error("steer_failed"))
      .mockImplementationOnce(async (message, id) => acceptedSteerEvent(message, id));
    const { result } = renderHook(() =>
      usePortalComposerWorkflowController({
        userId: "user-1",
        activeThreadId: "thread-1",
        onSteer
      })
    );

    await act(async () => {
      await expect(result.current.contextValue.steer("focus on deployment cost")).rejects.toThrow("steer_failed");
    });
    const failed = result.current.contextValue.steerEvents[0];
    expect(failed).toMatchObject({ status: "failed", message: "focus on deployment cost" });

    await act(async () => {
      await result.current.contextValue.retrySteer(failed.id);
    });
    expect(onSteer).toHaveBeenNthCalledWith(2, "focus on deployment cost", failed.id);
    expect(result.current.contextValue.steerEvents[0]?.status).toBe("accepted");
  });

  it("hydrates persisted steering history when a thread is opened", async () => {
    const persisted = acceptedSteerEvent("persisted direction", "portal-steer-persisted");
    const loadSteerEvents = vi.fn(async () => [persisted]);
    const { result } = renderHook(() =>
      usePortalComposerWorkflowController({
        userId: "user-1",
        activeThreadId: "thread-1",
        onSteer: unusedSteer,
        loadSteerEvents
      })
    );

    await waitFor(() => expect(result.current.contextValue.steerEvents).toEqual([persisted]));
    expect(loadSteerEvents).toHaveBeenCalledWith("thread-1");
  });

  it("keeps the explicit interruption recovery state when the stream subsequently finishes", () => {
    const { result } = renderHook(() =>
      usePortalComposerWorkflowController({
        userId: "user-1",
        activeThreadId: "thread-1",
        onSteer: unusedSteer
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
        onSteer: unusedSteer
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
