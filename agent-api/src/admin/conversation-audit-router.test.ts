import { describe, expect, it } from "vitest";

import {
  agentModeIdFromRunConfig,
  enabledSkillNamesFromRunConfig,
  extractMessageAttachments,
  extractMessageProcessRows,
  extractMessageText,
  matchesConversationSourceFilter,
  projectConversationTurnStatus,
  resolveConversationAudience,
  resolveThreadFileAbsolutePath,
  threadWorkspaceUploadDirs
} from "./conversation-audit-router.js";

describe("resolveConversationAudience", () => {
  it("classifies internal and external conversation owners", () => {
    expect(resolveConversationAudience({ userType: "internal_employee" })).toBe("internal");
    expect(resolveConversationAudience({ userType: "external_user" })).toBe("external");
    expect(resolveConversationAudience(null)).toBe("unknown");
    expect(resolveConversationAudience(null, { type: "zendesk" } as never)).toBe("external");
  });
});

describe("matchesConversationSourceFilter", () => {
  it("treats internal and external filters as Portal-only conversations", () => {
    expect(matchesConversationSourceFilter({ audience: "internal", channel: null }, "internal")).toBe(true);
    expect(matchesConversationSourceFilter({ audience: "external", channel: null }, "external")).toBe(true);
    expect(matchesConversationSourceFilter({ audience: "external", channel: { type: "zendesk" } }, "external")).toBe(false);
    expect(matchesConversationSourceFilter({ audience: "internal", channel: { type: "dingtalk_bot" } }, "internal")).toBe(false);
  });

  it("matches Zendesk and DingTalk by external channel", () => {
    expect(matchesConversationSourceFilter({ audience: "external", channel: { type: "zendesk" } }, "zendesk")).toBe(true);
    expect(matchesConversationSourceFilter({ audience: "internal", channel: { type: "dingtalk_bot" } }, "dingtalk")).toBe(true);
    expect(matchesConversationSourceFilter({ audience: "external", channel: null }, "zendesk")).toBe(false);
  });
});

describe("enabledSkillNamesFromRunConfig", () => {
  it("normalizes selected skill names from stored run config", () => {
    expect(
      enabledSkillNamesFromRunConfig({
        enabledSkills: ["imagegen", " lab-device-access ", "", "imagegen", null]
      })
    ).toEqual(["imagegen", "lab-device-access"]);
  });

  it("normalizes selected skill names from structured run config entries", () => {
    expect(
      enabledSkillNamesFromRunConfig({
        enabledSkills: [
          { id: "managed:skill-1", name: "knowledge-base-builder", managedSkillId: "skill-1" },
          { id: "native-skill", skillName: "browser" },
          { id: "empty-name", name: " " },
          { id: "duplicate", name: "knowledge-base-builder" }
        ]
      })
    ).toEqual(["knowledge-base-builder", "browser"]);
  });

  it("returns an empty list when no skills were selected", () => {
    expect(enabledSkillNamesFromRunConfig({ enabledSkills: undefined })).toEqual([]);
    expect(enabledSkillNamesFromRunConfig(undefined)).toEqual([]);
  });
});

describe("agentModeIdFromRunConfig", () => {
  it("uses the stored runtime mode as the conversation agent mode id", () => {
    expect(agentModeIdFromRunConfig({ mode: " agent-mode-1 " })).toBe("agent-mode-1");
  });

  it("falls back to legacy agentModeId values", () => {
    expect(agentModeIdFromRunConfig({ agentModeId: "legacy-mode" })).toBe("legacy-mode");
    expect(agentModeIdFromRunConfig({ mode: "", agentModeId: "fallback-mode" })).toBe("fallback-mode");
  });
});

describe("extractMessageText", () => {
  it("appends process error details when regular text content is already present", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "Primary answer" },
        { type: "data", name: "codex_process", data: { kind: "error", title: "Execution failed", detail: "Should not override answer" } }
      ]
    };

    expect(extractMessageText(message)).toBe("Primary answer\n\nExecution failed\n\nShould not override answer");
  });

  it("uses raw process error details for admin transcript text when user-facing text is sanitized", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "I couldn't complete this response. Please try again. If the issue continues, contact your workspace admin." },
        {
          type: "data",
          name: "codex_process",
          data: {
            kind: "error",
            title: "Execution failed",
            detail: "The request could not be completed. Please try again.",
            rawDetail: "Codex provider failed: Azure OpenAI deployment gpt-5-prod was not found"
          }
        }
      ]
    };

    expect(extractMessageText(message)).toBe(
      "I couldn't complete this response. Please try again. If the issue continues, contact your workspace admin.\n\nExecution failed\n\nCodex provider failed: Azure OpenAI deployment gpt-5-prod was not found"
    );
  });

  it("uses hidden audit process details when process trace is disabled", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "I couldn't complete this response. Please try again. If the issue continues, contact your workspace admin." },
        {
          type: "data",
          name: "codex_process_audit",
          data: {
            kind: "error",
            title: "Execution failed",
            detail: "The request could not be completed. Please try again.",
            rawDetail: "Codex SDK authentication failed: invalid API key"
          }
        }
      ]
    };

    expect(extractMessageText(message)).toBe(
      "I couldn't complete this response. Please try again. If the issue continues, contact your workspace admin.\n\nExecution failed\n\nCodex SDK authentication failed: invalid API key"
    );
  });

  it("falls back to codex process error details when assistant text is empty", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_process",
          data: {
            kind: "error",
            title: "Execution failed",
            detail: "Session does not match the requested thread. Please try again."
          }
        }
      ]
    };

    expect(extractMessageText(message)).toBe(
      "Execution failed\n\nSession does not match the requested thread. Please try again."
    );
  });

  it("falls back to trace batch error rows when no text part exists", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_trace_batch",
          data: {
            rows: [
              { kind: "process", title: "Planning", detail: "Normal step" },
              { kind: "error", title: "Execution error", detail: "Command exited with code 1" }
            ]
          }
        }
      ]
    };

    expect(extractMessageText(message)).toBe("Execution error\n\nCommand exited with code 1");
  });

  it("uses raw trace batch error details for admin transcript text", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_trace_batch",
          data: {
            rows: [
              {
                kind: "error",
                title: "Execution error",
                detail: "A background execution step failed.",
                rawDetail: "Codex SDK fatal error: model provider rejected the request"
              }
            ]
          }
        }
      ]
    };

    expect(extractMessageText(message)).toBe("Execution error\n\nCodex SDK fatal error: model provider rejected the request");
  });

  it("does not surface non-error process events as transcript text", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_process",
          data: {
            kind: "process",
            title: "File changes",
            detail: "update: README.md"
          }
        }
      ]
    };

    expect(extractMessageText(message)).toBe("");
  });
});

describe("projectConversationTurnStatus", () => {
  it("marks completed assistant messages as completed", () => {
    expect(projectConversationTurnStatus({ role: "assistant", status: { type: "completed" } }, "assistant")).toEqual({
      turnStatus: "completed",
      turnStatusReason: null
    });
  });

  it("marks cancelled assistant messages as user interruption", () => {
    expect(projectConversationTurnStatus({ role: "assistant", status: { type: "incomplete", reason: "cancelled" } }, "assistant")).toEqual({
      turnStatus: "cancelled",
      turnStatusReason: "用户发送了新消息或取消了上一轮生成，本轮未完成。"
    });
  });

  it("marks errored assistant messages as failed", () => {
    expect(projectConversationTurnStatus({ role: "assistant", status: { type: "error" } }, "assistant")).toEqual({
      turnStatus: "failed",
      turnStatusReason: "运行时异常，用户侧已显示通用失败提示。"
    });
  });

  it("marks unmatched user messages as disconnected", () => {
    expect(projectConversationTurnStatus({ role: "user" }, "user", { hasAssistantResponse: false })).toEqual({
      turnStatus: "disconnected",
      turnStatusReason: "用户消息已保存，但没有对应助手回复；可能是页面关闭、网络断开、请求启动失败或被后续消息替代。"
    });
  });
});

describe("extractMessageAttachments", () => {
  it("extracts uploaded attachment metadata from persisted attachment hints", () => {
    const attachments = extractMessageAttachments(
      "thread-123",
      {
        role: "user",
        attachments: [
          {
            type: "document",
            name: "report.pdf",
            contentType: "application/pdf",
            content: [
              {
                type: "text",
                text: [
                  '<uploaded_file name="report.pdf" path="/tmp/workspace/.uploads/171-report.pdf" relativePath="171-report.pdf" mimeType="application/pdf" bytes=2048>',
                  "The file has been uploaded to the workspace.",
                  "</uploaded_file>"
                ].join("\n")
              }
            ]
          }
        ]
      },
      "message-1"
    );

    expect(attachments).toEqual([
      {
        id: "message-1-attachment-1-1",
        kind: "document",
        name: "report.pdf",
        mimeType: "application/pdf",
        bytes: 2048,
        path: "/tmp/workspace/.uploads/171-report.pdf",
        relativePath: "171-report.pdf",
        contentUrl: "/api/admin/conversations/thread-123/files/content?relative_path=171-report.pdf"
      }
    ]);
  });

  it("falls back to attachment name when no uploaded file hint exists", () => {
    const attachments = extractMessageAttachments(
      "thread-123",
      {
        role: "user",
        attachments: [
          {
            type: "image",
            name: "diagram.png",
            contentType: "image/png",
            content: []
          }
        ]
      },
      "message-2"
    );

    expect(attachments).toEqual([
      {
        id: "message-2-attachment-1",
        kind: "image",
        name: "diagram.png",
        mimeType: "image/png",
        bytes: null,
        path: null,
        relativePath: null,
        contentUrl: null
      }
    ]);
  });
});

describe("resolveThreadFileAbsolutePath", () => {
  it("checks thread-scoped uploads before legacy workspace uploads", () => {
    expect(threadWorkspaceUploadDirs("/tmp/workspace", "thread-123")).toEqual([
      "/tmp/workspace/.agent-studio/uploads/thread-123",
      "/tmp/workspace/.uploads"
    ]);
  });

  it("resolves thread-scoped upload relative paths under .agent-studio/uploads", () => {
    expect(
      resolveThreadFileAbsolutePath({
        workspacePath: "/tmp/workspace",
        uploadDir: "/tmp/workspace/.agent-studio/uploads/thread-123",
        relativePath: "171-report.pdf"
      })
    ).toBe("/tmp/workspace/.agent-studio/uploads/thread-123/171-report.pdf");
  });

  it("keeps existing upload relative paths under .uploads", () => {
    expect(
      resolveThreadFileAbsolutePath({
        workspacePath: "/tmp/workspace",
        uploadDir: "/tmp/workspace/.uploads",
        relativePath: "171-report.pdf"
      })
    ).toBe("/tmp/workspace/.uploads/171-report.pdf");
  });

  it("allows Zendesk attachment relative paths under the workspace Zendesk attachment directory", () => {
    expect(
      resolveThreadFileAbsolutePath({
        workspacePath: "/tmp/workspace",
        uploadDir: "/tmp/workspace/.uploads",
        relativePath: ".zendesk/attachments/run-run-1/comment-101/01-signal screenshot.png"
      })
    ).toBe("/tmp/workspace/.zendesk/attachments/run-run-1/comment-101/01-signal screenshot.png");
  });

  it("blocks Zendesk attachment relative path traversal", () => {
    expect(() =>
      resolveThreadFileAbsolutePath({
        workspacePath: "/tmp/workspace",
        uploadDir: "/tmp/workspace/.uploads",
        relativePath: ".zendesk/attachments/../secret.txt"
      })
    ).toThrow("outside the allowed Zendesk attachment directory");
  });
});

describe("extractMessageProcessRows", () => {
  it("includes codex commentary thought entries alongside trace rows", () => {
    const thoughtAt = new Date("2026-04-22T09:00:00.000Z").getTime();
    const rows = extractMessageProcessRows({
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_commentary",
          data: {
            id: "assistant-thoughts",
            entries: [
              {
                id: "thought-1",
                text: "先确认管理员现在看不到的到底是哪类过程数据",
                lines: ["先确认管理员现在看不到的到底是哪类过程数据"],
                last_event_at: thoughtAt,
                status: "completed"
              }
            ],
            status: "completed"
          }
        },
        {
          type: "data",
          name: "codex_trace_batch",
          data: {
            rows: [
              {
                id: "row-1",
                kind: "tool",
                title: "Tool call · rg",
                detail: "rg -n codex_commentary",
                at: "2026-04-22T09:00:02.000Z"
              }
            ]
          }
        }
      ]
    });

    expect(rows).toEqual([
      {
        id: "thought-1",
        kind: "reasoning",
        title: "先确认管理员现在看不到的到底是哪类过程数据",
        detail: "先确认管理员现在看不到的到底是哪类过程数据",
        at: "2026-04-22T09:00:00.000Z"
      },
      {
        id: "row-1",
        kind: "tool",
        title: "Tool call · rg",
        detail: "rg -n codex_commentary",
        at: "2026-04-22T09:00:02.000Z"
      }
    ]);
  });

  it("prefers structured trace batch rows when present", () => {
    const rows = extractMessageProcessRows({
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_trace_batch",
          data: {
            rows: [
              { id: "row-1", kind: "reasoning", title: "分析需求", detail: "先确认问题范围", at: "2026-04-22T09:00:00.000Z" },
              { id: "row-2", kind: "tool", title: "Tool call · rg", detail: "rg -n attachment", at: "2026-04-22T09:00:02.000Z" }
            ]
          }
        },
        {
          type: "reasoning",
          text: "这条不应覆盖 trace batch"
        }
      ]
    });

    expect(rows).toEqual([
      {
        id: "row-1",
        kind: "reasoning",
        title: "分析需求",
        detail: "先确认问题范围",
        at: "2026-04-22T09:00:00.000Z"
      },
      {
        id: "row-2",
        kind: "tool",
        title: "Tool call · rg",
        detail: "rg -n attachment",
        at: "2026-04-22T09:00:02.000Z"
      }
    ]);
  });

  it("prefers raw process row details for admin when present", () => {
    const rows = extractMessageProcessRows({
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_trace_batch",
          data: {
            rows: [
              {
                id: "row-1",
                kind: "error",
                title: "Execution error",
                detail: "A background execution step failed.",
                rawDetail: "Codex provider failed: invalid API key",
                at: "2026-04-22T09:00:00.000Z"
              }
            ]
          }
        }
      ]
    });

    expect(rows).toEqual([
      {
        id: "row-1",
        kind: "error",
        title: "Execution error",
        detail: "Codex provider failed: invalid API key",
        at: "2026-04-22T09:00:00.000Z"
      }
    ]);
  });

  it("extracts hidden audit process rows when process trace is disabled", () => {
    const rows = extractMessageProcessRows({
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_process_audit",
          data: {
            kind: "error",
            title: "Execution failed",
            detail: "The request could not be completed. Please try again.",
            rawDetail: "Codex SDK authentication failed: invalid API key",
            at: "2026-04-22T09:00:00.000Z"
          }
        }
      ]
    });

    expect(rows).toEqual([
      {
        id: "process-row-1",
        kind: "error",
        title: "Execution failed",
        detail: "Codex SDK authentication failed: invalid API key",
        at: "2026-04-22T09:00:00.000Z"
      }
    ]);
  });

  it("falls back to reasoning, tool-call and codex_process parts", () => {
    const rows = extractMessageProcessRows({
      role: "assistant",
      content: [
        { type: "reasoning", id: "reason-1", text: "先检查管理台 transcript 数据结构" },
        { type: "tool-call", toolCallId: "tool-1", toolName: "rg", argsText: "rg -n processRows", result: { ok: true } },
        { type: "data", id: "proc-1", name: "codex_process", data: { kind: "done", title: "分析完成", detail: "已定位问题根因" } }
      ]
    });

    expect(rows).toEqual([
      {
        id: "reason-1",
        kind: "reasoning",
        title: "Reasoning summary",
        detail: "先检查管理台 transcript 数据结构"
      },
      {
        id: "tool-1",
        kind: "tool",
        title: "Tool call · rg",
        detail: "rg -n processRows\n\n{\n  \"ok\": true\n}"
      },
      {
        id: "proc-1",
        kind: "done",
        title: "分析完成",
        detail: "已定位问题根因"
      }
    ]);
  });
});
