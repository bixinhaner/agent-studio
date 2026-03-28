import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: vi.fn()
  };
});

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
    useLocalRuntime: () => ({}),
    unstable_useRemoteThreadListRuntime: () => ({})
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
});
