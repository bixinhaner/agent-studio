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
let currentThreadListItemState = {
  id: "",
  remoteId: "",
  title: ""
};

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
        getState: () => currentThreadListItemState,
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
  useAuiState: (selector: (state: { threadListItem: typeof currentThreadListItemState }) => unknown) =>
    selector({ threadListItem: currentThreadListItemState })
}));

vi.mock("../zendesk/ZendeskIntegrationPanel", () => ({
  ZendeskIntegrationPanel: () => <div data-testid="zendesk-panel" />
}));

vi.mock("../collaboration/ThreadCollaborationPanel", () => ({
  ThreadCollaborationPanel: ({
    threadId,
    collaboration,
    loading,
    errorText
  }: {
    threadId: string;
    collaboration: { access?: { canRun?: boolean } } | null;
    loading: boolean;
    errorText: string;
  }) => (
    <div data-testid="thread-collaboration-panel">
      {threadId}:{loading ? "loading" : collaboration?.access?.canRun === false ? "readonly" : "interactive"}:
      {errorText || "ok"}
    </div>
  )
}));

import PortalShell from "./PortalShell";
import { api } from "../../lib/api";
import { setThreadAssignment } from "../collaboration/api";

const mockedApi = vi.mocked(api);

describe("PortalShell knowledge set integration", () => {
  beforeEach(() => {
    capturedThreadListAdapter = null;
    capturedChatAdapter = null;
    currentThreadListItemState = {
      id: "",
      remoteId: "",
      title: ""
    };
    mockedApi.mockReset();
  });

  it("renders default and optional knowledge sets for the runtime workspace path", async () => {
    mockedApi
      .mockResolvedValueOnce({
        modes: [
          {
            id: "mode-code",
            label: "代码助手",
            description: "面向代码任务",
            runtimeProfile: {
              id: "profile-code",
              name: "Coding Default",
              slug: "profile-code",
              status: "active",
              defaultModel: "gpt-5.4-pro",
              allowedModels: ["gpt-5.4-pro"],
              defaultReasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "live"
            },
            allowDirectorySelection: true,
            skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
            workspaces: [
              {
                id: "/workspace/default",
                label: "default",
                isDefault: true,
                allowDirectorySelection: true,
                directoryScope: "descendants_only",
                loadWorkspaceAgentsMd: true
              }
            ],
            instructionSources: []
          }
        ],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "mode-code",
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

    expect(await screen.findByDisplayValue("代码助手")).toBeTruthy();
    expect(screen.getAllByText("gpt-5.4-pro").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/xhigh/i).length).toBeGreaterThan(0);
    expect(await screen.findByText("FAQ")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Runbooks" })).toBeTruthy();
  });

  it("renders the current portal user identity summary", async () => {
    mockedApi
      .mockResolvedValueOnce({
        modes: [
          {
            id: "mode-code",
            label: "代码助手",
            description: "面向代码任务",
            runtimeProfile: {
              id: "profile-code",
              name: "Coding Default",
              slug: "profile-code",
              status: "active",
              defaultModel: "gpt-5.4-pro",
              allowedModels: ["gpt-5.4-pro"],
              defaultReasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "live"
            },
            allowDirectorySelection: true,
            skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
            workspaces: [
              {
                id: "/workspace/default",
                label: "default",
                isDefault: true,
                allowDirectorySelection: true,
                directoryScope: "descendants_only",
                loadWorkspaceAgentsMd: true
              }
            ],
            instructionSources: []
          }
        ],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "mode-code",
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
            default_knowledge_sets: [],
            optional_knowledge_sets: []
          }
        ]
      });

    render(
      <PortalShell
        currentUser={{
          id: "employee-1",
          role: "employee",
          displayName: "Eve Employee",
          email: "eve@example.com"
        }}
      />
    );

    expect(await screen.findByText("Eve Employee")).toBeTruthy();
    expect(screen.getByText("员工")).toBeTruthy();
    expect(screen.getByText("eve@example.com")).toBeTruthy();
  });

  it("renders an admin switch button for privileged users", async () => {
    mockedApi
      .mockResolvedValueOnce({
        modes: [
          {
            id: "mode-code",
            label: "代码助手",
            description: "面向代码任务",
            runtimeProfile: {
              id: "profile-code",
              name: "Coding Default",
              slug: "profile-code",
              status: "active",
              defaultModel: "gpt-5.4-pro",
              allowedModels: ["gpt-5.4-pro"],
              defaultReasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "live"
            },
            allowDirectorySelection: true,
            skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
            workspaces: [
              {
                id: "/workspace/default",
                label: "default",
                isDefault: true,
                allowDirectorySelection: true,
                directoryScope: "descendants_only",
                loadWorkspaceAgentsMd: true
              }
            ],
            instructionSources: []
          }
        ],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "mode-code",
          workspace: "/workspace/default"
        }
      })
      .mockResolvedValueOnce({
        workspaces: []
      });
    const onOpenAdmin = vi.fn();

    render(
      <PortalShell
        currentUser={{
          id: "admin-1",
          role: "admin",
          displayName: "Alice Admin",
          email: "alice@example.com"
        }}
        onOpenAdmin={onOpenAdmin}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "进入管理台" }));
    expect(onOpenAdmin).toHaveBeenCalledTimes(1);
  });

  it("includes selected knowledge_set_ids in thread and session creation requests", async () => {
    mockedApi
      .mockResolvedValueOnce({
        modes: [
          {
            id: "mode-code",
            label: "代码助手",
            description: "面向代码任务",
            runtimeProfile: {
              id: "profile-code",
              name: "Coding Default",
              slug: "profile-code",
              status: "active",
              defaultModel: "gpt-5.4-pro",
              allowedModels: ["gpt-5.4-pro"],
              defaultReasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "live"
            },
            allowDirectorySelection: true,
            skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
            workspaces: [
              {
                id: "/workspace/default",
                label: "default",
                isDefault: true,
                allowDirectorySelection: true,
                directoryScope: "descendants_only",
                loadWorkspaceAgentsMd: true
              }
            ],
            instructionSources: []
          }
        ],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "mode-code",
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
        collaboration: {
          threadId: "thread-1",
          ownerUserId: "owner-1",
          access: {
            canRead: true,
            canComment: true,
            canRun: true,
            isOwner: true,
            canManage: true
          },
          shares: [],
          comments: [],
          assignment: null,
          followers: [],
          captureMark: null
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

  it("loads active-thread collaboration once and exposes shared-thread readonly copy when canRun is false", async () => {
    mockedApi
      .mockResolvedValueOnce({
        modes: [
          {
            id: "mode-code",
            label: "代码助手",
            description: "面向代码任务",
            runtimeProfile: {
              id: "profile-code",
              name: "Coding Default",
              slug: "profile-code",
              status: "active",
              defaultModel: "gpt-5.4-pro",
              allowedModels: ["gpt-5.4-pro"],
              defaultReasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "live"
            },
            allowDirectorySelection: true,
            skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
            workspaces: [
              {
                id: "/workspace/default",
                label: "default",
                isDefault: true,
                allowDirectorySelection: true,
                directoryScope: "descendants_only",
                loadWorkspaceAgentsMd: true
              }
            ],
            instructionSources: []
          }
        ],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "mode-code",
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
            default_knowledge_sets: [],
            optional_knowledge_sets: []
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
        }
      })
      .mockResolvedValueOnce({
        collaboration: {
          threadId: "thread-1",
          ownerUserId: "owner-1",
          access: {
            canRead: true,
            canComment: true,
            canRun: false,
            isOwner: false,
            canManage: false
          },
          shares: [],
          comments: [],
          assignment: null,
          followers: [],
          captureMark: null
        }
      });

    const view = render(<PortalShell />);

    expect(await screen.findByDisplayValue("代码助手")).toBeTruthy();

    await act(async () => {
      await capturedThreadListAdapter?.initialize("thread-1");
    });

    currentThreadListItemState = {
      id: "local-thread-1",
      remoteId: "thread-1",
      title: "Shared thread"
    };
    view.rerender(<PortalShell />);

    expect(await screen.findByText("共享视图中可查看消息和附件，但不能继续运行该线程。")).toBeTruthy();
    expect((await screen.findByTestId("thread-collaboration-panel")).textContent).toBe("thread-1:readonly:ok");
    expect(mockedApi).toHaveBeenCalledWith("/api/threads/thread-1/collaboration");
  });

  it("blocks actual run startup when the active collaboration state disallows canRun", async () => {
    mockedApi
      .mockResolvedValueOnce({
        modes: [
          {
            id: "mode-code",
            label: "代码助手",
            description: "面向代码任务",
            runtimeProfile: {
              id: "profile-code",
              name: "Coding Default",
              slug: "profile-code",
              status: "active",
              defaultModel: "gpt-5.4-pro",
              allowedModels: ["gpt-5.4-pro"],
              defaultReasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "live"
            },
            allowDirectorySelection: true,
            skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
            workspaces: [
              {
                id: "/workspace/default",
                label: "default",
                isDefault: true,
                allowDirectorySelection: true,
                directoryScope: "descendants_only",
                loadWorkspaceAgentsMd: true
              }
            ],
            instructionSources: []
          }
        ],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "mode-code",
          workspace: "/workspace/default"
        }
      })
      .mockResolvedValueOnce({
        workspaces: [{ id: "ws-docs", label: "Docs", slug: "docs", is_default: true, runtime_workspace_path: "/workspace/default", default_knowledge_sets: [], optional_knowledge_sets: [] }]
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
        }
      })
      .mockResolvedValueOnce({
        collaboration: {
          threadId: "thread-1",
          ownerUserId: "owner-1",
          access: {
            canRead: true,
            canComment: true,
            canRun: false,
            isOwner: false,
            canManage: false
          },
          shares: [],
          comments: [],
          assignment: null,
          followers: [],
          captureMark: null
        }
      });

    render(<PortalShell />);

    expect(await screen.findByDisplayValue("代码助手")).toBeTruthy();

    await act(async () => {
      await capturedThreadListAdapter?.initialize("thread-1");
    });

    currentThreadListItemState = {
      id: "local-thread-1",
      remoteId: "thread-1",
      title: "Shared thread"
    };

    expect(await screen.findByText("共享视图中可查看消息和附件，但不能继续运行该线程。")).toBeTruthy();

    await expect(
      (async () => {
        if (!capturedChatAdapter) throw new Error("missing chat adapter");
        for await (const _chunk of capturedChatAdapter.run({
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          unstable_threadId: "thread-1",
          abortSignal: new AbortController().signal
        })) {
          // noop
        }
      })()
    ).rejects.toThrow("当前共享线程为只读模式，不能继续运行。");

    expect(mockedApi).not.toHaveBeenCalledWith(
      "/api/threads/thread-1/session",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("blocks run startup while active-thread collaboration access is still loading", async () => {
    let resolveCollaboration: ((value: Record<string, unknown>) => void) | undefined;

    mockedApi
      .mockResolvedValueOnce({
        modes: [
          {
            id: "mode-code",
            label: "代码助手",
            description: "面向代码任务",
            runtimeProfile: {
              id: "profile-code",
              name: "Coding Default",
              slug: "profile-code",
              status: "active",
              defaultModel: "gpt-5.4-pro",
              allowedModels: ["gpt-5.4-pro"],
              defaultReasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "live"
            },
            allowDirectorySelection: true,
            skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
            workspaces: [
              {
                id: "/workspace/default",
                label: "default",
                isDefault: true,
                allowDirectorySelection: true,
                directoryScope: "descendants_only",
                loadWorkspaceAgentsMd: true
              }
            ],
            instructionSources: []
          }
        ],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "mode-code",
          workspace: "/workspace/default"
        }
      })
      .mockResolvedValueOnce({
        workspaces: [{ id: "ws-docs", label: "Docs", slug: "docs", is_default: true, runtime_workspace_path: "/workspace/default", default_knowledge_sets: [], optional_knowledge_sets: [] }]
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
        }
      })
      .mockImplementationOnce(
        async () =>
          await new Promise((resolve) => {
            resolveCollaboration = resolve;
          })
      );

    render(<PortalShell />);

    expect(await screen.findByDisplayValue("代码助手")).toBeTruthy();

    await act(async () => {
      await capturedThreadListAdapter?.initialize("thread-1");
    });

    currentThreadListItemState = {
      id: "local-thread-1",
      remoteId: "thread-1",
      title: "Pending access thread"
    };

    expect((await screen.findByTestId("thread-collaboration-panel")).textContent).toBe("thread-1:loading:ok");

    await expect(
      (async () => {
        if (!capturedChatAdapter) throw new Error("missing chat adapter");
        for await (const _chunk of capturedChatAdapter.run({
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          unstable_threadId: "thread-1",
          abortSignal: new AbortController().signal
        })) {
          // noop
        }
      })()
    ).rejects.toThrow("当前线程协作权限加载中，请稍后再试。");

    expect(mockedApi).not.toHaveBeenCalledWith(
      "/api/threads/thread-1/session",
      expect.objectContaining({ method: "POST" })
    );

    if (resolveCollaboration) {
      resolveCollaboration({
        collaboration: {
          threadId: "thread-1",
          ownerUserId: "owner-1",
          access: {
            canRead: true,
            canComment: true,
            canRun: true,
            isOwner: true,
            canManage: true
          },
          shares: [],
          comments: [],
          assignment: null,
          followers: [],
          captureMark: null
        }
      });
    }

    expect((await screen.findByTestId("thread-collaboration-panel")).textContent).toBe("thread-1:interactive:ok");
  });

  it("clears readonly state immediately when switching to another thread", async () => {
    let resolveSecondCollaboration: ((value: Record<string, unknown>) => void) | undefined;

    mockedApi
      .mockResolvedValueOnce({
        modes: [
          {
            id: "mode-code",
            label: "代码助手",
            description: "面向代码任务",
            runtimeProfile: {
              id: "profile-code",
              name: "Coding Default",
              slug: "profile-code",
              status: "active",
              defaultModel: "gpt-5.4-pro",
              allowedModels: ["gpt-5.4-pro"],
              defaultReasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "live"
            },
            allowDirectorySelection: true,
            skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
            workspaces: [
              {
                id: "/workspace/default",
                label: "default",
                isDefault: true,
                allowDirectorySelection: true,
                directoryScope: "descendants_only",
                loadWorkspaceAgentsMd: true
              }
            ],
            instructionSources: []
          }
        ],
        workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
        canUpload: true,
        defaults: {
          mode: "mode-code",
          workspace: "/workspace/default"
        }
      })
      .mockResolvedValueOnce({
        workspaces: [{ id: "ws-docs", label: "Docs", slug: "docs", is_default: true, runtime_workspace_path: "/workspace/default", default_knowledge_sets: [], optional_knowledge_sets: [] }]
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
        }
      })
      .mockResolvedValueOnce({
        collaboration: {
          threadId: "thread-1",
          ownerUserId: "owner-1",
          access: {
            canRead: true,
            canComment: true,
            canRun: false,
            isOwner: false,
            canManage: false
          },
          shares: [],
          comments: [],
          assignment: null,
          followers: [],
          captureMark: null
        }
      })
      .mockResolvedValueOnce({
        thread: {
          id: "thread-2",
          status: "regular",
          model: "gpt-5",
          reasoning_effort: "high",
          workspace: "/workspace/default",
          created_at: "2026-03-29T00:00:00.000Z",
          updated_at: "2026-03-29T00:00:00.000Z"
        }
      })
      .mockImplementationOnce(
        async () =>
          await new Promise((resolve) => {
            resolveSecondCollaboration = resolve;
          })
      );

    const view = render(<PortalShell />);

    expect(await screen.findByDisplayValue("代码助手")).toBeTruthy();

    await act(async () => {
      await capturedThreadListAdapter?.initialize("thread-1");
    });

    expect(await screen.findByText("共享视图中可查看消息和附件，但不能继续运行该线程。")).toBeTruthy();

    await act(async () => {
      await capturedThreadListAdapter?.initialize("thread-2");
    });

    currentThreadListItemState = {
      id: "local-thread-2",
      remoteId: "thread-2",
      title: "Thread 2"
    };
    view.rerender(<PortalShell />);

    expect(screen.queryByText("共享视图中可查看消息和附件，但不能继续运行该线程。")).toBeNull();
    expect((await screen.findByTestId("thread-collaboration-panel")).textContent).toBe("thread-2:loading:ok");

    if (resolveSecondCollaboration) {
      resolveSecondCollaboration({
        collaboration: {
          threadId: "thread-2",
          ownerUserId: "owner-1",
          access: {
            canRead: true,
            canComment: true,
            canRun: true,
            isOwner: true,
            canManage: true
          },
          shares: [],
          comments: [],
          assignment: null,
          followers: [],
          captureMark: null
        }
      });
    }

    expect((await screen.findByTestId("thread-collaboration-panel")).textContent).toBe("thread-2:interactive:ok");
  });

  it("does not serialize follower_ids when assignment helper input omits them", async () => {
    mockedApi.mockResolvedValueOnce({
      assignment: {
        id: "assignment-1",
        threadId: "thread-1",
        ownerUserId: "user-9",
        assignedByUserId: "user-1",
        assignedAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z"
      },
      followers: []
    });

    await setThreadAssignment("thread-1", { ownerUserId: "user-9" });

    expect(mockedApi).toHaveBeenCalledWith(
      "/api/threads/thread-1/assignment",
      expect.objectContaining({
        method: "PUT",
        json: { owner_user_id: "user-9" }
      })
    );
  });
});
