import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationUpstreamWaits, formatWaitDuration } from "./ConversationUpstreamWaits";

describe("ConversationUpstreamWaits", () => {
  it("renders nothing without waits", () => {
    const { container } = render(<ConversationUpstreamWaits waits={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows how often and how long an answer waited on the model service", () => {
    render(
      <ConversationUpstreamWaits
        waits={[
          {
            usageEventId: "u1",
            recordedAt: "2026-11-18T03:17:00.000Z",
            resultStatus: "success",
            source: "action_connector_chat_stream",
            count: 2,
            totalWaitMs: 630_000,
            kinds: ["serverOverloaded"],
            entries: [
              { at: "2026-11-18T03:06:00.000Z", attempt: 1, maxAttempts: 5, kind: "serverOverloaded", message: "Reconnecting... 1/5", waitedMs: 330_000, resumedAt: "2026-11-18T03:11:30.000Z" },
              { at: "2026-11-18T03:11:30.000Z", attempt: 2, maxAttempts: 5, kind: "serverOverloaded", message: "Reconnecting... 2/5", waitedMs: null, resumedAt: null }
            ]
          }
        ]}
      />
    );
    expect(screen.getByText("模型服务繁忙，等待后重试")).toBeTruthy();
    expect(screen.getAllByText("模型容量不足").length).toBeGreaterThan(0);
    expect(screen.getByText("最终完成")).toBeTruthy();
    expect(screen.getByText(/等待 2 次，共 10.5 分钟/)).toBeTruthy();
    expect(screen.getByText(/第 1\/5 次重试.*等待 5.5 分钟后恢复/)).toBeTruthy();
    expect(screen.getByText(/第 2\/5 次重试.*之后无新进展/)).toBeTruthy();
  });

  it("formats short and long waits", () => {
    expect(formatWaitDuration(45_000)).toBe("45 秒");
    expect(formatWaitDuration(null)).toBe("等待中");
  });
});
