import { describe, expect, it, vi } from "vitest";

import { streamRuntimeCompletionWithBestEffortUsage } from "./live-runtime-session.js";

async function* events(items: Array<Record<string, unknown>>) {
  for (const item of items) {
    yield item;
  }
}

describe("streamRuntimeCompletionWithBestEffortUsage", () => {
  it("returns only the last completed agent message as the final answer", async () => {
    const onDone = vi.fn();

    await streamRuntimeCompletionWithBestEffortUsage({
      events: events([
        {
          type: "item.updated",
          delta: "我先查一下资料。",
          text: "我先查一下资料。",
          raw: {
            type: "item.updated",
            item: {
              type: "agent_message",
              text: "我先查一下资料。"
            }
          }
        },
        {
          type: "item.completed",
          text: "我先查一下资料。",
          raw: {
            type: "item.completed",
            item: {
              type: "agent_message",
              text: "我先查一下资料。"
            }
          }
        },
        {
          type: "item.completed",
          text: "西安婚假是 **15 天**。",
          raw: {
            type: "item.completed",
            item: {
              type: "agent_message",
              text: "西安婚假是 **15 天**。"
            }
          }
        }
      ]),
      onEvent: vi.fn(),
      onDone
    });

    expect(onDone).toHaveBeenCalledWith({
      answer: "西安婚假是 **15 天**。",
      usage: undefined
    });
  });

  it("keeps the legacy delta fallback when completed agent messages are unavailable", async () => {
    const onDone = vi.fn();

    await streamRuntimeCompletionWithBestEffortUsage({
      events: events([
        { type: "message.delta", delta: "第一段" },
        { type: "message.delta", delta: "第二段" }
      ]),
      onEvent: vi.fn(),
      onDone
    });

    expect(onDone).toHaveBeenCalledWith({
      answer: "第一段第二段",
      usage: undefined
    });
  });
});
