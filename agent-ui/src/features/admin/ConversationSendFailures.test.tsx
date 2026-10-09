import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationSendFailures, sendFailureStageCopy } from "./ConversationSendFailures";

describe("ConversationSendFailures", () => {
  it("renders nothing without failures", () => {
    const { container } = render(<ConversationSendFailures failures={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("explains why a conversation has no saved message", () => {
    render(
      <ConversationSendFailures
        failures={[
          {
            id: "f1",
            source: "client",
            stage: "message_save",
            errorCode: null,
            httpStatus: 502,
            detail: "upstream unavailable",
            messagePreview: "这个是烽火的OLT，帮我看看",
            attachments: [{ name: "image.png", status: "requires-action" }],
            clientRunId: "run-1",
            buildId: null,
            userAgent: null,
            createdAt: "2026-10-09T06:57:22.000Z"
          }
        ]}
      />
    );
    expect(screen.getByLabelText("发送失败记录")).toBeTruthy();
    expect(screen.getByText("保存用户消息失败")).toBeTruthy();
    expect(screen.getByText("HTTP 502")).toBeTruthy();
    expect(screen.getByText("浏览器上报")).toBeTruthy();
    expect(screen.getByText("这个是烽火的OLT，帮我看看")).toBeTruthy();
    expect(screen.getByText("image.png · requires-action")).toBeTruthy();
  });

  it("falls back to a generic label for stages added later", () => {
    expect(sendFailureStageCopy("future_stage").label).toBe("发送失败");
  });
});
