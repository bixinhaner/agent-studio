import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineVisualizationFrame, INLINE_VISUALIZATION_MAX_HEIGHT } from "./InlineVisualizationFrame";
import { INLINE_VISUALIZATION_MESSAGE_SOURCE } from "./inline-visualization-document";

function setup(onFollowUp = vi.fn()) {
  const view = render(
    <InlineVisualizationFrame
      fragment='<div id="viz"></div>'
      title="交互式可视化"
      storageKey="thread-1:chart.html"
      theme="light"
      onFollowUp={onFollowUp}
    />
  );
  const iframe = view.container.querySelector("iframe")!;
  const channel = /"channel":"([^"]+)"/.exec(iframe.getAttribute("srcdoc") || "")![1];
  const postFromFrame = (data: Record<string, unknown>, source: Window | null = iframe.contentWindow) => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: INLINE_VISUALIZATION_MESSAGE_SOURCE, channel, ...data },
          source
        })
      );
    });
  };
  return { iframe, channel, postFromFrame, onFollowUp };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("InlineVisualizationFrame", () => {
  it("renders a sandboxed frame without same-origin access", () => {
    const { iframe } = setup();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("allow")).toBe("clipboard-write");
    expect(iframe.getAttribute("srcdoc")).toContain('<div id="viz"></div>');
  });

  it("sizes the frame to the reported content height within bounds", () => {
    const { iframe, postFromFrame } = setup();
    postFromFrame({ type: "resize", height: 412.4 });
    expect(iframe.style.height).toBe("413px");
    postFromFrame({ type: "resize", height: 99999 });
    expect(iframe.style.height).toBe(`${INLINE_VISUALIZATION_MAX_HEIGHT}px`);
  });

  it("ignores messages from other windows or channels", () => {
    const { iframe, postFromFrame, onFollowUp } = setup();
    postFromFrame({ type: "resize", height: 300 }, window);
    postFromFrame({ type: "follow_up", prompt: "hi", channel: "other" });
    expect(iframe.style.height).toBe("160px");
    expect(onFollowUp).not.toHaveBeenCalled();
  });

  it("hands follow-ups to the host instead of sending them", () => {
    const { postFromFrame, onFollowUp } = setup();
    postFromFrame({ type: "follow_up", prompt: "  解释一下 Q3 的下滑  ", title: "解释 Q3", requestId: 1 });
    expect(onFollowUp).toHaveBeenCalledWith({ prompt: "解释一下 Q3 的下滑", title: "解释 Q3" });

    postFromFrame({ type: "follow_up", prompt: "x".repeat(9000), requestId: 2 });
    expect(onFollowUp).toHaveBeenCalledTimes(1);
  });

  it("persists widget state per thread visualization and restores it on the next render", () => {
    const { postFromFrame } = setup();
    postFromFrame({ type: "set_widget_state", state: { privateContent: { people: 8 } } });
    cleanup();

    const { iframe } = setup();
    expect(iframe.getAttribute("srcdoc")).toContain('"widgetState":{"privateContent":{"people":8}}');
  });

  it("opens only http(s) links in a new tab", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { postFromFrame } = setup();
    postFromFrame({ type: "open_external", href: "javascript:alert(1)" });
    postFromFrame({ type: "open_external", href: "https://example.com/a" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
  });
});
