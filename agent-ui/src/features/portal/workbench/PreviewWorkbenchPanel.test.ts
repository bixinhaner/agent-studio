// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { alignPreviewTarget } from "./PreviewWorkbenchPanel";

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
