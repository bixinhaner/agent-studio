import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let capturedThreadListAdapter: {
  initialize(threadId: string): Promise<unknown>;
} | null = null;
let capturedChatAdapter: {
  run(options: {
    messages: unknown[];
    unstable_threadId?: string;
    abortSignal?: AbortSignal;
  }): AsyncGenerator<unknown>;
} | null = null;

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
    apiBase: vi.fn(() => "http://localhost:3000"),
    authHeaders: vi.fn(() => ({})),
    notifyAuthInvalidStatus: vi.fn()
  };
});

vi.mock("../../lib/sse", () => ({
  iterateSSE: vi.fn(async function* () {
    yield {
      event: "done",
      data: { answer: "done" }
    };
  })
}));

vi.mock("../../lib/thread-id-resolver", () => ({
  resolveRunThreadId: vi.fn(async () => "thread-1")
}));

vi.mock("@assistant-ui/react", () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    AssistantRuntimeProvider: passthrough,
    ComposerPrimitive: {
      AttachmentDropzone: passthrough
    },
    RuntimeAdapterProvider: passthrough,
    ThreadListItemPrimitive: {
      Root: passthrough,
      Trigger: passthrough,
      Title: () => null,
      Delete: passthrough
    },
    useAui: () => ({
      threadListItem: () => ({
        getState: () => ({ remoteId: "", id: "", title: "" }),
        rename: vi.fn(),
        initialize: vi.fn(),
        generateTitle: vi.fn()
      })
    }),
    useLocalRuntime: (adapter: unknown) => {
      capturedChatAdapter = adapter as typeof capturedChatAdapter;
      return {};
    },
    unstable_useRemoteThreadListRuntime: ({ adapter, runtimeHook }: { adapter: unknown; runtimeHook: () => unknown }) => {
      capturedThreadListAdapter = adapter as typeof capturedThreadListAdapter;
      runtimeHook();
      return {};
    }
  };
});

vi.mock("@assistant-ui/react-ui", () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    AssistantActionBar: () => null,
    AssistantMessage: {
      Root: passthrough,
      Avatar: () => null,
      Content: passthrough
    },
    BranchPicker: () => null,
    Thread: passthrough,
    ThreadList: {
      Root: passthrough,
      New: () => null,
      Items: () => null
    },
    makeMarkdownText: () => () => null
  };
});

vi.mock("@assistant-ui/core", () => ({
  CompositeAttachmentAdapter: class CompositeAttachmentAdapter {
    constructor(_adapters: unknown[]) {}
  }
}));

vi.mock("@assistant-ui/store", () => ({
  useAuiState: () => ({ threadListItem: { id: "", remoteId: "", title: "" } })
}));

vi.mock("../zendesk/ZendeskIntegrationPanel", () => ({
  ZendeskIntegrationPanel: () => <div data-testid="zendesk-panel" />
}));

import PortalShell from "./PortalShell";
import { api } from "../../lib/api";

const mockedApi = vi.mocked(api);

describe("PortalShell knowledge set integration", () => {
  beforeEach(() => {
    capturedThreadListAdapter = null;
    capturedChatAdapter = null;
    mockedApi.mockReset();
  });

  it("renders default and optional knowledge sets for the runtime workspace path", async () => {
    mockedApi
      .mockResolvedValueOnce({
        modes: [{ id: "standard", label: "通用助手" }],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "standard",
          workspace: "/workspace/default"
        }
      })
      .mockResolvedValueOnce({
        workspaces: [
          {
            id: "ws-docs",
            label: "Docs",
            slug: "docs",
            is_default: true,
            runtime_workspace_path: "/workspace/default",
            default_knowledge_sets: [{ id: "ks-faq", label: "FAQ", slug: "faq" }],
            optional_knowledge_sets: [{ id: "ks-runbook", label: "Runbooks", slug: "runbooks" }]
          }
        ]
      });

    render(<PortalShell />);

    expect(await screen.findByText("FAQ")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Runbooks" })).toBeTruthy();
  });

  it("includes selected knowledge_set_ids in thread and session creation requests", async () => {
    mockedApi
      .mockResolvedValueOnce({
        modes: [{ id: "standard", label: "通用助手" }],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "standard",
          workspace: "/workspace/default"
        }
      })
      .mockResolvedValueOnce({
        workspaces: [
          {
            id: "ws-docs",
            label: "Docs",
            slug: "docs",
            is_default: true,
            runtime_workspace_path: "/workspace/default",
            default_knowledge_sets: [{ id: "ks-faq", label: "FAQ", slug: "faq" }],
            optional_knowledge_sets: [{ id: "ks-runbook", label: "Runbooks", slug: "runbooks" }]
          }
        ]
      })
      .mockResolvedValueOnce({
        thread: {
          id: "thread-1",
          status: "regular",
          model: "gpt-5",
          reasoning_effort: "high",
          workspace: "/workspace/default",
          created_at: "2026-03-29T00:00:00.000Z",
          updated_at: "2026-03-29T00:00:00.000Z"
        },
        session: {
          session_id: "session-1",
          model: "gpt-5",
          reasoning_effort: "high",
          workspace: "/workspace/default",
          created_at: "2026-03-29T00:00:00.000Z",
          updated_at: "2026-03-29T00:00:00.000Z"
        }
      })
      .mockResolvedValueOnce({
        session: {
          session_id: "session-2",
          model: "gpt-5",
          reasoning_effort: "high",
          workspace: "/workspace/default",
          created_at: "2026-03-29T00:00:00.000Z",
          updated_at: "2026-03-29T00:00:00.000Z"
        }
      });

    render(<PortalShell />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Runbooks" }));

    expect(capturedThreadListAdapter).toBeTruthy();
    expect(capturedChatAdapter).toBeTruthy();

    await act(async () => {
      await capturedThreadListAdapter?.initialize("local-thread-1");
    });

    await act(async () => {
      if (!capturedChatAdapter) return;
      for await (const _chunk of capturedChatAdapter.run({
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        unstable_threadId: "thread-1",
        abortSignal: new AbortController().signal
      })) {
        // consume the stream until completion
      }
    });

    expect(mockedApi).toHaveBeenCalledWith(
      "/api/threads",
      expect.objectContaining({
        method: "POST",
        json: expect.objectContaining({
          knowledge_set_ids: ["ks-runbook"]
        })
      })
    );
    expect(mockedApi).toHaveBeenCalledWith(
      "/api/threads/thread-1/session",
      expect.objectContaining({
        method: "POST",
        json: expect.objectContaining({
          knowledge_set_ids: ["ks-runbook"]
        })
      })
    );
  });
});
