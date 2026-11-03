import { cleanup, render, screen, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type AssistantRuntime,
  type ChatModelAdapter
} from "@assistant-ui/react";

import {
  PortalLiveAnswerContext,
  PortalLiveAnswerView,
  portalLiveAnswerFromOut,
  shouldShowLiveAnswer,
  type PortalLiveAnswer
} from "./live-answer";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const liveOut = (text: string) => ({
  running: true as const,
  run_id: "run-1",
  user_message_id: "question-1",
  message: {
    id: "portal-live-run-1",
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    status: { type: "running" },
    createdAt: "2026-11-03T10:00:00.000Z",
    metadata: { custom: { live: true } }
  }
});

describe("portalLiveAnswerFromOut", () => {
  it("keeps a running answer for the question it answers", () => {
    const answer = portalLiveAnswerFromOut("thread-1", liveOut("进行中"));
    expect(answer).toMatchObject({ threadId: "thread-1", runId: "run-1", userMessageId: "question-1" });
    expect(answer?.message.status).toEqual({ type: "running" });
  });

  it("ignores a finished run or one without its question", () => {
    expect(portalLiveAnswerFromOut("thread-1", { running: false })).toBeUndefined();
    expect(portalLiveAnswerFromOut("thread-1", { ...liveOut("x"), user_message_id: null })).toBeUndefined();
  });
});

describe("shouldShowLiveAnswer", () => {
  const answer = portalLiveAnswerFromOut("thread-1", liveOut("x"));
  it("shows only right after the question being answered", () => {
    expect(shouldShowLiveAnswer(answer, { id: "question-1", role: "user" })).toBe(true);
    // The finished answer is loaded: the history shows it instead.
    expect(shouldShowLiveAnswer(answer, { id: "answer-1", role: "assistant" })).toBe(false);
    // A newer question was sent (from this or another device).
    expect(shouldShowLiveAnswer(answer, { id: "question-2", role: "user" })).toBe(false);
    expect(shouldShowLiveAnswer(undefined, { id: "question-1", role: "user" })).toBe(false);
  });
});

const model: ChatModelAdapter = { async *run() { yield { content: [{ type: "text", text: "local" }] }; } };
const AssistantMessage = () => (
  <MessagePrimitive.Root>
    <div data-testid="assistant">
      <MessagePrimitive.Parts />
    </div>
  </MessagePrimitive.Root>
);
const UserMessage = () => (
  <MessagePrimitive.Root>
    <div data-testid="user">
      <MessagePrimitive.Parts />
    </div>
  </MessagePrimitive.Root>
);

let runtime: AssistantRuntime;
function Harness({ answer }: { answer?: PortalLiveAnswer }) {
  runtime = useLocalRuntime(model);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <PortalLiveAnswerContext.Provider value={answer}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          <PortalLiveAnswerView AssistantMessage={AssistantMessage} />
        </ThreadPrimitive.Root>
      </PortalLiveAnswerContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function importQuestion() {
  act(() => {
    runtime.thread.import({
      headId: "question-1",
      messages: [
        {
          parentId: null,
          message: {
            id: "question-1",
            role: "user",
            createdAt: new Date(0),
            content: [{ type: "text", text: "处理的怎么样了" }],
            attachments: [],
            metadata: { custom: {} }
          } as never
        }
      ]
    });
  });
}

describe("PortalLiveAnswerView", () => {
  it("mirrors the running answer below the question without adding it to this page's timeline", async () => {
    const first = portalLiveAnswerFromOut("thread-1", liveOut("第一步完成"));
    const { rerender } = render(<Harness answer={first} />);
    importQuestion();
    expect(await screen.findByText("第一步完成")).toBeTruthy();
    expect(runtime.thread.getState().messages).toHaveLength(1);
    expect(runtime.thread.getState().isRunning).toBe(false);

    rerender(<Harness answer={portalLiveAnswerFromOut("thread-1", liveOut("第一步完成，第二步进行中"))} />);
    expect(await screen.findByText("第一步完成，第二步进行中")).toBeTruthy();
    expect(screen.getAllByTestId("assistant")).toHaveLength(1);
  });

  it("disappears once the finished answer is in the history", async () => {
    render(<Harness answer={portalLiveAnswerFromOut("thread-1", liveOut("进行中的回答"))} />);
    importQuestion();
    expect(await screen.findByText("进行中的回答")).toBeTruthy();
    act(() => {
      runtime.thread.import({
        headId: "answer-1",
        messages: [
          {
            parentId: null,
            message: {
              id: "question-1",
              role: "user",
              createdAt: new Date(0),
              content: [{ type: "text", text: "处理的怎么样了" }],
              attachments: [],
              metadata: { custom: {} }
            } as never
          },
          {
            parentId: "question-1",
            message: {
              id: "answer-1",
              role: "assistant",
              createdAt: new Date(1),
              content: [{ type: "text", text: "完整回答" }],
              status: { type: "complete", reason: "stop" },
              metadata: { custom: {} }
            } as never
          }
        ]
      });
    });
    expect(await screen.findByText("完整回答")).toBeTruthy();
    expect(screen.queryByText("进行中的回答")).toBeNull();
  });
});
