import { describe, expect, it } from "vitest";

import {
  buildUserAssistantPairs,
  extractMessageText,
  inferBackfillChannel,
  normalizeBackfillFilters
} from "./backfill-service.js";

function message(input: {
  id: string;
  role: "user" | "assistant";
  position: number;
  content: unknown;
  externalId?: string;
  parentId?: string;
}) {
  return {
    id: input.id,
    externalId: input.externalId ?? null,
    role: input.role,
    content: input.content,
    parentId: input.parentId ?? null,
    runConfig: null,
    position: input.position,
    createdAt: new Date(`2026-06-14T00:00:0${input.position}.000Z`)
  };
}

describe("CodexMemoryBackfillService helpers", () => {
  it("extracts only textual user and assistant content", () => {
    expect(extractMessageText({
      role: "assistant",
      content: [
        { type: "data", data: { rows: [{ title: "Tool call completed" }] } },
        { type: "text", text: "最终回答" },
        { type: "source", url: "https://example.com" }
      ]
    })).toBe("最终回答");
  });

  it("pairs every user message with the next assistant response before the next user", () => {
    const pairs = buildUserAssistantPairs([
      message({ id: "u1", externalId: "u1-ext", role: "user", position: 1, content: "问题一" }),
      message({ id: "a1", role: "assistant", position: 2, parentId: "u1-ext", content: "回答一" }),
      message({ id: "tool", role: "assistant", position: 3, content: "过程不应单独配对" }),
      message({ id: "u2", role: "user", position: 4, content: "问题二" }),
      message({ id: "a2", role: "assistant", position: 5, content: "回答二" })
    ]);
    expect(pairs.map((pair) => [pair.user.id, pair.assistant.id])).toEqual([
      ["u1", "a1"],
      ["u2", "a2"]
    ]);
  });

  it("infers user-friendly channels from run config, workspace, and thread title", () => {
    expect(inferBackfillChannel({ codexRunConfig: { channel: "crest" } })).toBe("crest");
    expect(inferBackfillChannel({ workspace: "/var/lib/agent-studio/sessions/integrations/zendesk/abc/agent-x" }))
      .toBe("zendesk");
    expect(inferBackfillChannel({ threadTitle: "钉钉单聊 - 李可" })).toBe("dingtalk");
    expect(inferBackfillChannel({ threadTitle: "普通会话" })).toBe("portal");
  });

  it("normalizes filters without leaking empty channel values", () => {
    expect(normalizeBackfillFilters({
      channels: [" portal ", "", "zendesk", "portal"],
      limit: 999999
    })).toEqual({
      channels: ["portal", "zendesk"],
      limit: 20000
    });
  });
});
