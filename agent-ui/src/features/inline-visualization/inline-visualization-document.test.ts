// @ts-expect-error jsdom is a transitive test dependency without bundled types.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  buildInlineVisualizationDocument,
  INLINE_VISUALIZATION_CSP,
  INLINE_VISUALIZATION_MESSAGE_SOURCE
} from "./inline-visualization-document";

const baseOptions = { channel: "chan-1", theme: "light" as const, locale: "zh-CN", widgetState: null };

function runDocument(html: string) {
  const dom: { window: Window & typeof globalThis } = new JSDOM(html, { runScripts: "dangerously" });
  const posted: Array<Record<string, unknown>> = [];
  dom.window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as Record<string, unknown>;
    if (data?.source === INLINE_VISUALIZATION_MESSAGE_SOURCE && data.type !== "response" && data.type !== "set_globals") {
      posted.push(data);
    }
  });
  return { dom, posted };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("buildInlineVisualizationDocument", () => {
  it("wraps a fragment with the skill host kit, CSP allowlist and theme", () => {
    const html = buildInlineVisualizationDocument('<div id="viz-root" class="card">Hi</div>', baseOptions);

    expect(html).toContain('<html lang="zh-CN" data-theme="light">');
    expect(html).toContain('<div id="viz-root" class="card">Hi</div>');
    expect(html).toContain("--viz-series-1");
    expect(html).toContain("https://unpkg.com/lucide");
    expect(html).toContain("Content-Security-Policy");
    expect(INLINE_VISUALIZATION_CSP).toContain("script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: https://cdnjs.cloudflare.com");
    expect(INLINE_VISUALIZATION_CSP).toContain("connect-src blob: data:");
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("viz-root"));
  });

  it("keeps `$` sequences in fragments intact", () => {
    const html = buildInlineVisualizationDocument("<p>Total $&amp; $1 $'</p>", baseOptions);
    expect(html).toContain("<p>Total $&amp; $1 $'</p>");
  });

  it("injects the host head into whole documents before their own content", () => {
    const html = buildInlineVisualizationDocument(
      "<!doctype html><html><head><title>Old</title></head><body><p id='x'>Old</p></body></html>",
      baseOptions
    );
    const headIndex = html.indexOf("<head>");
    expect(html.indexOf("Content-Security-Policy")).toBeGreaterThan(headIndex);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<title>Old"));
    expect(html.indexOf("codex-visualization-lucide")).toBeLessThan(html.indexOf("</body>"));
  });

  it("escapes widget state so it cannot close the bridge script", () => {
    const html = buildInlineVisualizationDocument("<div></div>", {
      ...baseOptions,
      widgetState: { note: "</script><script>alert(1)</script>" }
    });
    const { dom } = runDocument(html);
    expect((dom.window as unknown as { openai: { widgetState: unknown } }).openai.widgetState).toEqual({
      note: "</script><script>alert(1)</script>"
    });
  });
});

describe("inline visualization bridge", () => {
  it("exposes window.openai and reports ready, follow-ups, widget state and external links", async () => {
    const html = buildInlineVisualizationDocument('<a id="src" href="https://example.com/report">Source</a>', baseOptions);
    const { dom, posted } = runDocument(html);
    const openai = (dom.window as unknown as {
      openai: {
        theme: string;
        sendFollowUpMessage: (input: { prompt: string; title?: string }) => Promise<unknown>;
        setWidgetState: (state: unknown) => Promise<void>;
        widgetState: unknown;
      };
    }).openai;

    expect(openai.theme).toBe("light");
    expect(dom.window.document.documentElement.dataset.theme).toBe("light");

    void openai.sendFollowUpMessage({ prompt: "Explain Q3", title: "Explain" });
    await openai.setWidgetState({ modelContent: { selected: "Q3" } });
    expect(openai.widgetState).toEqual({ modelContent: { selected: "Q3" } });
    dom.window.document.getElementById("src")!.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
    );
    await flush();

    const types = posted.map((message) => message.type);
    expect(types).toContain("ready");
    expect(posted.find((message) => message.type === "follow_up")).toMatchObject({
      channel: "chan-1",
      prompt: "Explain Q3",
      title: "Explain"
    });
    expect(posted.find((message) => message.type === "set_widget_state")).toMatchObject({
      state: { modelContent: { selected: "Q3" } }
    });
    expect(posted.find((message) => message.type === "open_external")).toMatchObject({
      href: "https://example.com/report"
    });
  });

  it("rejects oversized widget state and empty follow-ups", async () => {
    const { dom } = runDocument(buildInlineVisualizationDocument("<div></div>", baseOptions));
    const openai = (dom.window as unknown as {
      openai: {
        sendFollowUpMessage: (input: { prompt: string }) => Promise<unknown>;
        setWidgetState: (state: unknown) => Promise<void>;
      };
    }).openai;

    await expect(openai.setWidgetState({ blob: "x".repeat(17 * 1024) })).rejects.toThrow("16 KiB");
    await expect(openai.sendFollowUpMessage({ prompt: "  " })).rejects.toThrow("prompt is required");
  });

  it("applies host theme updates and emits openai:set_globals", async () => {
    const { dom } = runDocument(buildInlineVisualizationDocument("<div></div>", baseOptions));
    const events: unknown[] = [];
    dom.window.addEventListener("openai:set_globals", (event: Event) => events.push((event as CustomEvent).detail));

    // The frame's parent is itself in a standalone JSDOM.
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", {
        data: { source: INLINE_VISUALIZATION_MESSAGE_SOURCE, channel: "chan-1", type: "set_globals", globals: { theme: "dark" } },
        source: dom.window
      })
    );

    expect(dom.window.document.documentElement.dataset.theme).toBe("dark");
    expect((dom.window as unknown as { openai: { theme: string } }).openai.theme).toBe("dark");
    expect(events).toEqual([{ globals: { theme: "dark" } }]);
  });
});
