import { describe, expect, it, vi } from "vitest";

import { replaceLiveRuntimeSession } from "./live-runtime-session.js";

describe("replaceLiveRuntimeSession", () => {
  it("replaces the live runtime thread for an existing session update", async () => {
    const oldLiveThread = { id: "old-thread" };
    const newLiveThread = { id: "new-thread" };
    const liveRuntimeThreads = new Map<string, { id: string }>([["session-1", oldLiveThread]]);
    const runtime = {
      startThreadWithOptions: vi.fn(async () => newLiveThread)
    };
    const persist = vi.fn(async (payload: Record<string, unknown>) => payload);

    const result = await replaceLiveRuntimeSession({
      runtime,
      liveRuntimeThreads,
      sessionId: "session-1",
      threadId: "thread-1",
      model: "gpt-5.4",
      reasoningEffort: "high",
      workspace: "/workspace/docs",
      codexRunConfig: {
        mode: "standard",
        workspace: "/workspace/docs",
        additionalDirectories: ["/knowledge/docs"],
        _agentStudioKnowledgeSets: {
          workspacePath: "/workspace/docs",
          selectedOptionalIds: [],
          mountPaths: ["/knowledge/docs"]
        }
      },
      getThreadUploadDir(threadId: string) {
        return `/tmp/uploads/${threadId}`;
      },
      persist
    });

    expect(runtime.startThreadWithOptions).toHaveBeenCalledWith({
      model: "gpt-5.4",
      reasoningEffort: "high",
      workspace: "/workspace/docs",
      codexRunConfig: {
        mode: "standard",
        workspace: "/workspace/docs",
        additionalDirectories: ["/knowledge/docs", "/tmp/uploads/thread-1"]
      }
    });
    expect(persist).toHaveBeenCalledWith({
      model: "gpt-5.4",
      reasoningEffort: "high",
      workspace: "/workspace/docs",
      codexRunConfig: {
        mode: "standard",
        workspace: "/workspace/docs",
        additionalDirectories: ["/knowledge/docs", "/tmp/uploads/thread-1"],
        _agentStudioKnowledgeSets: {
          workspacePath: "/workspace/docs",
          selectedOptionalIds: [],
          mountPaths: ["/knowledge/docs"]
        }
      }
    });
    expect(liveRuntimeThreads.get("session-1")).toEqual(newLiveThread);
    expect(liveRuntimeThreads.get("session-1")).not.toBe(oldLiveThread);
    expect(result).toEqual({
      model: "gpt-5.4",
      reasoningEffort: "high",
      workspace: "/workspace/docs",
      codexRunConfig: {
        mode: "standard",
        workspace: "/workspace/docs",
        additionalDirectories: ["/knowledge/docs", "/tmp/uploads/thread-1"],
        _agentStudioKnowledgeSets: {
          workspacePath: "/workspace/docs",
          selectedOptionalIds: [],
          mountPaths: ["/knowledge/docs"]
        }
      }
    });
  });
});
