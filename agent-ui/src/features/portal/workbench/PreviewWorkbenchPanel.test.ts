// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { alignPreviewTarget, parseXlsxCellRange, prepareInteractiveHtmlPreview } from "./PreviewWorkbenchPanel";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function previewElements() {
  const scroller = document.createElement("div");
  scroller.className = "preview-viewer-body";
  const target = document.createElement("h2");
  scroller.appendChild(target);
  document.body.appendChild(scroller);

  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(scroller, "scrollTop", { configurable: true, writable: true, value: 100 });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 500,
    left: 0,
    right: 600,
    width: 600,
    height: 400,
    x: 0,
    y: 100,
    toJSON: () => ({})
  });
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    top: 300,
    bottom: 320,
    left: 0,
    right: 300,
    width: 300,
    height: 20,
    x: 0,
    y: 300,
    toJSON: () => ({})
  });
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo;
  return { scroller, target, scrollTo };
}

describe("alignPreviewTarget", () => {
  it("aligns a section inside the preview scroller instead of scrolling the page", () => {
    const { target, scrollTo } = previewElements();

    alignPreviewTarget(target, "start", "auto");

    expect(scrollTo).toHaveBeenCalledWith({ top: 288, behavior: "auto" });
  });

  it("centers a target line inside the preview scroller", () => {
    const { target, scrollTo } = previewElements();

    alignPreviewTarget(target, "center", "smooth");

    expect(scrollTo).toHaveBeenCalledWith({ top: 110, behavior: "smooth" });
  });
});

describe("prepareInteractiveHtmlPreview", () => {
  it("enables inline visualization code while blocking network and form submission", () => {
    const html = prepareInteractiveHtmlPreview("<html><head><title>Chart</title></head><body></body></html>");

    expect(html).toContain("script-src 'unsafe-inline'");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<title>"));
  });

  it("adds the policy to an HTML fragment", () => {
    const html = prepareInteractiveHtmlPreview("<section>Chart</section>");

    expect(html).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
    expect(html).toContain("<section>Chart</section>");
  });
});

describe("parseXlsxCellRange", () => {
  it("normalizes a multi-cell A1 range for citation highlighting", () => {
    expect(parseXlsxCellRange("T29:A2")).toEqual({
      startRow: 2,
      endRow: 29,
      startColumn: 1,
      endColumn: 20
    });
  });

  it("accepts absolute single-cell references and rejects invalid ranges", () => {
    expect(parseXlsxCellRange("$C$7")).toEqual({
      startRow: 7,
      endRow: 7,
      startColumn: 3,
      endColumn: 3
    });
    expect(parseXlsxCellRange("sheet1!A1")).toBeNull();
  });
});
