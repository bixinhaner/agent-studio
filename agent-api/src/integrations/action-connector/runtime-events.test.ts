import { describe, expect, it } from "vitest";

import {
  actionConnectorCommentaryEntriesToEvents,
  projectActionConnectorRuntimeEvents
} from "./runtime-events.js";

describe("action connector runtime event projection", () => {
  it("projects answer, thought and process events without collapsing runtime detail", () => {
    const events = projectActionConnectorRuntimeEvents({
      eventType: "item.completed",
      itemType: "command_execution",
      answerDelta: "The device query completed.",
      commentaryDelta: {
        id: "thought-1",
        text: "Checking available actions.",
        append: true,
        status: "streaming",
        at: "2026-07-08T00:00:00.000Z",
        last_event_at: 1783449600000
      },
      traceRows: [
        {
          id: "cmd-1-command",
          kind: "process",
          title: "Workspace operation completed",
          detail: "$ node action-connector-cli execute device.search",
          rawDetail: "{\"total\":1}",
          at: "2026-07-08T00:00:01.000Z"
        }
      ]
    });

    expect(events).toEqual([
      {
        type: "thought",
        id: "thought-1",
        text: "Checking available actions.",
        append: true,
        status: "streaming",
        at: "2026-07-08T00:00:00.000Z",
        lastEventAt: 1783449600000
      },
      {
        type: "process",
        id: "cmd-1-command",
        kind: "process",
        title: "Workspace operation completed",
        detail: "{\"total\":1}",
        at: "2026-07-08T00:00:01.000Z"
      },
      { type: "delta", text: "The device query completed." }
    ]);
  });

  it("projects completed commentary entries as completed thought events", () => {
    expect(
      actionConnectorCommentaryEntriesToEvents([
        {
          id: "entry-1",
          text: "Selected a read-only action.",
          lines: ["Selected a read-only action."],
          status: "completed",
          last_event_at: 1783449600100
        }
      ])
    ).toEqual([
      {
        type: "thought",
        id: "entry-1",
        text: "Selected a read-only action.",
        append: false,
        status: "completed",
        lastEventAt: 1783449600100
      }
    ]);
  });

  it("projects tool calls and action previews for compatible connector outputs", () => {
    const events = projectActionConnectorRuntimeEvents({
      eventType: "item.completed",
      itemType: "mcp_tool_call",
      toolCall: {
        id: "tool-1",
        name: "external.actions",
        args: { actionId: "device.restart" },
        result: {
          requiresConfirmation: true,
          title: "Restart device",
          summary: "This operation changes device state.",
          risk: "high"
        }
      },
      traceRows: []
    });

    expect(events).toEqual([
      {
        type: "tool_call",
        callId: "tool-1",
        toolName: "external.actions",
        title: "external.actions",
        input: { actionId: "device.restart" }
      },
      {
        type: "action_preview",
        callId: "tool-1",
        title: "Restart device",
        summary: "This operation changes device state.",
        risk: "high",
        preview: {
          requiresConfirmation: true,
          title: "Restart device",
          summary: "This operation changes device state.",
          risk: "high"
        }
      }
    ]);
  });
});
