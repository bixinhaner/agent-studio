// @vitest-environment jsdom

import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  alignPreviewTarget,
  parseXlsxCellRange,
  prepareInteractiveHtmlPreview,
  supportsPaginatedOfficePreview
} from "./PreviewWorkbenchPanel";
import { PreviewWorkbenchPanel } from "./PreviewWorkbenchPanel";

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

describe("supportsPaginatedOfficePreview", () => {
  it("uses paginated conversion for documents and presentations only", () => {
    expect(supportsPaginatedOfficePreview("report.docx")).toBe(true);
    expect(supportsPaginatedOfficePreview("slides.pptx")).toBe(true);
    expect(supportsPaginatedOfficePreview("drawing.odg")).toBe(true);
    expect(supportsPaginatedOfficePreview("network.vsdx")).toBe(true);
    expect(supportsPaginatedOfficePreview("table.xlsx")).toBe(false);
    expect(supportsPaginatedOfficePreview("table.ods")).toBe(false);
  });

  it("requests the paginated endpoint and opens a cited Word page in the PDF viewer", async () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:office-preview");
    URL.revokeObjectURL = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["%PDF-test"], { type: "application/pdf" }), {
        status: 200,
        headers: { "content-type": "application/pdf" }
      })
    );

    try {
      const { container } = render(
        createElement(PreviewWorkbenchPanel, {
          threadId: "thread-123",
          requestedFilePath: "reports/quarter.docx#codex-file-citation?page_number=4"
        })
      );

      await waitFor(() => {
        expect(container.querySelector<HTMLIFrameElement>(".preview-iframe")?.getAttribute("src")).toBe(
          "blob:office-preview#page=4"
        );
      });
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        "/api/threads/thread-123/files/content?path=reports%2Fquarter.docx&preview=pdf"
      );
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });
});

describe("structured file preview", () => {
  it("previews a historical attachment from its authenticated content URL", async () => {
    const attachmentUrl = "/api/threads/thread-attachment/attachments/abc123def456/content?relative_path=input.csv";
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:attachment-preview");
    URL.revokeObjectURL = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("region,amount\nNorth,120", {
        status: 200,
        headers: { "content-type": "text/csv" }
      })
    );

    try {
      const { container } = render(
        createElement(PreviewWorkbenchPanel, {
          threadId: "thread-attachment",
          requestedFilePath: "input.csv",
          requestedContentUrl: attachmentUrl,
          requestedDownloadUrl: attachmentUrl,
          requestedFileName: "销售数据.csv",
          requestedFileMimeType: "text/csv"
        })
      );

      await waitFor(() => expect(container.textContent).toContain("North,120"));
      expect(fetchMock).toHaveBeenCalledWith(
        attachmentUrl,
        expect.objectContaining({ method: "GET", credentials: "include" })
      );
      expect(container.textContent).toContain("销售数据.csv");
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  it("loads logs in bounded pages and searches through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const params = new URL(url, "https://example.test").searchParams;
      const search = params.get("search") || "";
      return new Response(JSON.stringify({
        kind: "text",
        encoding: "utf-8",
        offset: Number(params.get("offset") || 0),
        limit: 200,
        lines: search
          ? [{ number: 346, text: "line 346 needle" }]
          : [{ number: 1, text: "line 1" }],
        totalLines: search ? 520 : null,
        totalLinesKnown: Boolean(search),
        hasPrevious: false,
        hasNext: !search,
        query: search || undefined,
        sizeBytes: 1024,
        partial: true
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(
      createElement(PreviewWorkbenchPanel, {
        threadId: "thread-logs",
        requestedFilePath: "logs/service.log"
      })
    );

    await waitFor(() => expect(container.textContent).toContain("line 1"));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("preview=text");
    const input = container.querySelector<HTMLInputElement>(".preview-search input");
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "needle" } });
    fireEvent.submit(input!.closest("form")!);
    await waitFor(() => expect(container.textContent).toContain("line 346 needle"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("search=needle"))).toBe(true);
  });

  it("loads the page containing a cited text line and highlights the exact line", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        kind: "text",
        encoding: "utf-8",
        offset: 200,
        limit: 200,
        lines: [{ number: 346, text: "target line" }],
        totalLines: null,
        totalLinesKnown: false,
        hasPrevious: true,
        hasNext: true,
        sizeBytes: 4096,
        partial: true
      }), { status: 200, headers: { "content-type": "application/json" } })
    );
    const { container } = render(
      createElement(PreviewWorkbenchPanel, {
        threadId: "thread-line-citation",
        requestedFilePath: "logs/service.log#L346"
      })
    );
    await waitFor(() => expect(container.textContent).toContain("target line"));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("offset=200");
    expect(container.querySelector(".preview-text-line.is-target")?.textContent).toContain("346");
  });

  it("loads only the selected workbook window while listing every sheet", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({
        kind: "table",
        format: "xlsx",
        sheets: Array.from({ length: 8 }, (_, index) => ({
          name: `Sheet ${index + 1}`,
          rowCount: 500,
          columnCount: 80
        })),
        selectedSheet: "Sheet 1",
        rowOffset: 0,
        rowLimit: 100,
        columnOffset: 0,
        columnLimit: 40,
        rows: [["SN", "Name"], ["1", "Alpha"]],
        totalRows: 500,
        totalColumns: 80,
        hasPreviousRows: false,
        hasNextRows: true,
        hasPreviousColumns: false,
        hasNextColumns: true,
        partial: true
      }), { status: 200, headers: { "content-type": "application/json" } })
    );

    const { container } = render(
      createElement(PreviewWorkbenchPanel, {
        threadId: "thread-xlsx",
        requestedFilePath: "reports/all.xlsx"
      })
    );
    await waitFor(() => {
      expect(container.textContent).toContain("Alpha");
      expect(container.querySelectorAll("select option")).toHaveLength(8);
    });
    expect(container.textContent).toContain("Partial view: rows 1-2 and columns 1-40 of 500 rows and 80 columns");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("preview=table");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("row_limit=100");
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
