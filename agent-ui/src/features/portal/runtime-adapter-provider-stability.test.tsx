import {
  Component,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FC,
  type PropsWithChildren,
  type ReactNode
} from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  RuntimeAdapterProvider,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useLocalRuntime,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
  type AssistantRuntime,
  type ChatModelAdapter,
  type ThreadHistoryAdapter
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

type RemoteThreadListAdapter = Parameters<typeof useRemoteThreadListRuntime>[0]["adapter"];

// Mirrors PortalShell: the thread list adapter's unstable_Provider wraps every thread runtime,
// and message shells re-render on locale changes while reading their message by index.

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
const LocaleContext = createContext("zh-CN");
const RenderTickContext = createContext(0);
let bumpRenderTick: () => void = () => undefined;

const HistoryProvider: FC<PropsWithChildren<{ locale: string }>> = ({ children }) => {
  const aui = useAui();
  // Like AgentRuntimeAdapterProvider reporting the thread identity back to the shell on mount.
  useEffect(() => bumpRenderTick(), []);
  const history = useMemo<ThreadHistoryAdapter>(() => ({
    async load() {
      if (!aui.threadListItem().getState().remoteId) return { messages: [] };
      const messages = [];
      let parentId: string | null = null;
      for (let index = 0; index < 4; index += 1) {
        const id = `message-${index}`;
        const role = index % 2 === 0 ? "user" : "assistant";
        messages.push({
          parentId,
          message: role === "user"
            ? { id, role, createdAt: new Date(0), content: [{ type: "text", text: id }], attachments: [], metadata: { custom: {} } }
            : { id, role, createdAt: new Date(0), content: [{ type: "text", text: id }], status: { type: "complete", reason: "stop" }, metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} } }
        });
        parentId = id;
      }
      return { headId: parentId, messages } as never;
    },
    async append() {}
  }), [aui]);
  return <RuntimeAdapterProvider adapters={{ history }}>{children}</RuntimeAdapterProvider>;
};

const AdapterSettingsContext = createContext("zh-CN");
// Fixed version: one stable component, settings read from context.
const StableBridge: FC<PropsWithChildren> = ({ children }) => {
  const locale = useContext(AdapterSettingsContext);
  return <HistoryProvider locale={locale}>{children}</HistoryProvider>;
};

function baseAdapter(): Omit<RemoteThreadListAdapter, "unstable_Provider"> {
  return {
    async list() { return { threads: [{ status: "regular", remoteId: "thread-1", title: "Thread" }] } as never; },
    async initialize(threadId: string) { return { remoteId: threadId, externalId: undefined }; },
    async rename() {},
    async archive() {},
    async unarchive() {},
    async delete() {},
    async fetch(threadId: string) { return { status: "regular", remoteId: threadId, title: "Thread" } as never; },
    async generateTitle() { return createAssistantStream((controller) => { controller.appendText("Thread"); controller.close(); }); }
  };
}

const MessageShell = () => {
  useContext(LocaleContext);
  useContext(RenderTickContext);
  const id = useAuiState((state) => state.message.id);
  return <MessagePrimitive.Root><span data-message={id}>{id}</span></MessagePrimitive.Root>;
};

let runtime: AssistantRuntime;
let setLocale: (locale: string) => void = () => undefined;

function Harness({ stableProvider, onError }: { stableProvider: boolean; onError: (error: Error) => void }) {
  const [locale, updateLocale] = useState("zh-CN");
  const [renderTick, setRenderTick] = useState(0);
  setLocale = updateLocale;
  bumpRenderTick = () => setRenderTick((tick) => tick + 1);
  const adapter = useMemo<RemoteThreadListAdapter>(
    () => ({
      ...baseAdapter(),
      unstable_Provider: stableProvider
        ? StableBridge
        : ({ children }: PropsWithChildren) => <HistoryProvider locale={locale}>{children}</HistoryProvider>
    }),
    // The pre-fix adapter depended on the locale; the fixed one never changes.
    stableProvider ? [] : [locale] // eslint-disable-line react-hooks/exhaustive-deps
  );
  runtime = useRemoteThreadListRuntime({ adapter, runtimeHook: function RuntimeHook() { return useLocalRuntime(model); } });
  return (
    <LocaleContext.Provider value={locale}>
      <RenderTickContext.Provider value={renderTick}>
      <AdapterSettingsContext.Provider value={locale}>
        <AssistantRuntimeProvider runtime={runtime}>
          <Boundary onError={onError}>
            <ThreadPrimitive.Root>
              <ThreadPrimitive.Messages components={{ UserMessage: MessageShell, AssistantMessage: MessageShell }} />
            </ThreadPrimitive.Root>
          </Boundary>
        </AssistantRuntimeProvider>
      </AdapterSettingsContext.Provider>
      </RenderTickContext.Provider>
    </LocaleContext.Provider>
  );
}

async function openThread() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    void runtime.threads.switchToThread("thread-1");
  });
  await waitFor(() => expect(document.querySelectorAll("[data-message]")).toHaveLength(4));
}

describe("thread runtime adapter provider", () => {
  it("keeps the loaded messages and renders when the locale changes", async () => {
    const onError = vi.fn();
    render(<Harness stableProvider onError={onError} />);
    await openThread();

    await act(async () => {
      setLocale("en");
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelectorAll("[data-message]")).toHaveLength(4);
  });

  it("documents the regression: a locale-dependent Provider rebuilds the runtime under mounted messages", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    render(<Harness stableProvider={false} onError={onError} />);
    await openThread();

    await act(async () => {
      setLocale("en");
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(String(onError.mock.calls[0]?.[0])).toMatch(/out of bounds/);
    consoleError.mockRestore();
  });
});
