import {
  collectRuntimeCompletion,
  type RuntimeCompletionTextMode,
  type RuntimeStreamEvent,
  type RuntimeUsageSnapshot,
  streamRuntimeCompletionWithBestEffortUsage
} from "../live-runtime-session.js";

export type CodexStreamCompletionInput = Parameters<typeof streamRuntimeCompletionWithBestEffortUsage>[0];
export type CodexCollectCompletionInput = Parameters<typeof collectRuntimeCompletion>[0];
export type CodexCompletionResult = { answer: string; usage?: RuntimeUsageSnapshot };

type RuntimeStreamSource<TThread> = {
  runStreamed(thread: TThread, message: string): AsyncIterable<RuntimeStreamEvent>;
};

export class CodexExecutionService {
  async streamCompletion(input: CodexStreamCompletionInput): Promise<void> {
    await streamRuntimeCompletionWithBestEffortUsage(input);
  }

  async streamFromRuntime<TThread>(input: Omit<CodexStreamCompletionInput, "events"> & {
    runtime: RuntimeStreamSource<TThread>;
    thread: TThread;
    prompt: string;
  }): Promise<void> {
    await streamRuntimeCompletionWithBestEffortUsage({
      events: input.runtime.runStreamed(input.thread, input.prompt),
      onEvent: input.onEvent,
      onDone: input.onDone,
      recordUsage: input.recordUsage,
      onTelemetryError: input.onTelemetryError
    });
  }

  async collectCompletion(input: CodexCollectCompletionInput): Promise<CodexCompletionResult> {
    return await collectRuntimeCompletion(input);
  }

  async collectFromRuntime<TThread>(input: {
    runtime: RuntimeStreamSource<TThread>;
    thread: TThread;
    prompt: string;
    textMode?: RuntimeCompletionTextMode;
    onEvent?(event: RuntimeStreamEvent): void | Promise<void>;
    onUsage?(usage: RuntimeUsageSnapshot, event: RuntimeStreamEvent): void | Promise<void>;
    onTextDelta?(delta: string, event: RuntimeStreamEvent): void | Promise<void>;
  }): Promise<CodexCompletionResult> {
    return await collectRuntimeCompletion({
      events: input.runtime.runStreamed(input.thread, input.prompt),
      textMode: input.textMode,
      onEvent: input.onEvent,
      onUsage: input.onUsage,
      onTextDelta: input.onTextDelta
    });
  }
}
