import { Component, useEffect, useState, type FC, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type AssistantRuntime,
  type ChatModelAdapter
} from "@assistant-ui/react";

import { createProcessDataFallback, MEMORY_CONTEXT_PART_NAME, type ProcessDataPartProps } from "./process-data-part-dispatch";
import { USER_INPUT_REQUEST_PART_NAME } from "./user-input-request";

class Boundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? <p role="alert">thread failed</p> : this.props.children;
  }
}

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const model: ChatModelAdapter = { async *run() { yield { content: [{ type: "text", text: "done" }] }; } };

// Generic parts use state and an effect, like the real process part renderer.
const GenericPart: FC<ProcessDataPartProps> = ({ name }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <span data-part={name}>{mounted ? "generic" : ""}</span>;
};
const MemoryChip: FC<{ data: unknown }> = () => <span data-part={MEMORY_CONTEXT_PART_NAME}>memory</span>;
const UserInputCard: FC<{ data: unknown }> = () => <span data-part={USER_INPUT_REQUEST_PART_NAME}>question</span>;

const DispatchedFallback = createProcessDataFallback({
  memoryContext: MemoryChip,
  userInputRequest: UserInputCard,
  connectionRecovery: () => <span data-part="codex_connection_recovery">recovering</span>,
  recoveryFailure: () => <span data-part="codex_recovery_failure">failed</span>,
  generic: GenericPart
});

// The pre-fix shape: special parts returned before the effect that other parts run.
const EarlyReturnFallback: FC<ProcessDataPartProps> = ({ name }) => {
  const [mounted, setMounted] = useState(false);
  if (name === MEMORY_CONTEXT_PART_NAME) return <span data-part={name}>memory</span>;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => setMounted(true), []);
  return <span data-part={name}>{mounted ? "generic" : ""}</span>;
};

let runtime: AssistantRuntime;
function Harness({ fallback, onError }: { fallback: FC<ProcessDataPartProps>; onError: (error: Error) => void }) {
  runtime = useLocalRuntime(model);
  const AssistantMessage = () => (
    <MessagePrimitive.Root>
      <MessagePrimitive.Parts components={{ data: { Fallback: fallback as never } }} />
    </MessagePrimitive.Root>
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Boundary onError={onError}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages components={{ UserMessage: () => null, AssistantMessage }} />
        </ThreadPrimitive.Root>
      </Boundary>
    </AssistantRuntimeProvider>
  );
}

const dataPart = (name: string) => ({ type: "data", name, data: {} });

function showAnswer(parts: Array<Record<string, unknown>>) {
  act(() => {
    runtime.thread.import({
      headId: "answer",
      messages: [
        {
          parentId: null,
          message: { id: "question", role: "user", createdAt: new Date(0), content: [{ type: "text", text: "hi" }], attachments: [], metadata: { custom: {} } } as never
        },
        {
          parentId: "question",
          message: {
            id: "answer",
            role: "assistant",
            createdAt: new Date(0),
            content: parts,
            status: { type: "complete", reason: "stop" },
            metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
          } as never
        }
      ]
    });
  });
}

const firstPart = () => document.querySelector("[data-part]")?.getAttribute("data-part");

describe("process data part dispatch", () => {
  it("keeps rendering when the part at an index changes kind while an answer streams", async () => {
    const onError = vi.fn();
    render(<Harness fallback={DispatchedFallback} onError={onError} />);

    // Commentary renders first; the memory chip arrives later and is ordered in front of it.
    showAnswer([dataPart("codex_commentary"), { type: "text", text: "partial" }]);
    await waitFor(() => expect(firstPart()).toBe("codex_commentary"));
    showAnswer([dataPart(MEMORY_CONTEXT_PART_NAME), dataPart("codex_commentary"), { type: "text", text: "more" }]);
    await waitFor(() => expect(firstPart()).toBe(MEMORY_CONTEXT_PART_NAME));
    showAnswer([dataPart("codex_trace_batch"), dataPart(USER_INPUT_REQUEST_PART_NAME)]);
    await waitFor(() => expect(firstPart()).toBe("codex_trace_batch"));
    showAnswer([dataPart("codex_connection_recovery"), dataPart("codex_file_change")]);
    await waitFor(() => expect(firstPart()).toBe("codex_connection_recovery"));
    showAnswer([dataPart("codex_commentary")]);
    await waitFor(() => expect(firstPart()).toBe("codex_commentary"));

    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("resets generic part state when a different kind takes its index", async () => {
    render(<Harness fallback={DispatchedFallback} onError={vi.fn()} />);
    showAnswer([dataPart("codex_commentary")]);
    const commentary = await waitFor(() => {
      const element = document.querySelector('[data-part="codex_commentary"]');
      expect(element).not.toBeNull();
      return element;
    });
    showAnswer([dataPart("codex_trace_batch")]);
    await waitFor(() => expect(firstPart()).toBe("codex_trace_batch"));
    expect(commentary?.isConnected).toBe(false);
  });

  it("documents the regression: the early-return renderer crashes on the same update", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    render(<Harness fallback={EarlyReturnFallback} onError={onError} />);
    showAnswer([dataPart("codex_commentary")]);
    await waitFor(() => expect(firstPart()).toBe("codex_commentary"));
    showAnswer([dataPart(MEMORY_CONTEXT_PART_NAME), dataPart("codex_commentary")]);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/fewer hooks|hooks/i);
    consoleError.mockRestore();
  });
});
