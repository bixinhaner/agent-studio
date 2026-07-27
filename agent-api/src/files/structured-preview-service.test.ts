import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  detectPreviewFile,
  sendStructuredPreview
} from "./structured-preview-service.js";

const tempRoots: string[] = [];

function responseCapture() {
  const headers = new Map<string, string>();
  const state: { status: number; body?: unknown } = { status: 200 };
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), String(value));
      return response;
    },
    status(value: number) {
      state.status = value;
      return response;
    },
    json(value: unknown) {
      state.body = value;
      return response;
    },
    type(value: string) {
      headers.set("content-type", value);
      return response;
    },
    send(value: unknown) {
      state.body = value;
      return response;
    }
  };
  return { response: response as never, state, headers };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("structured preview service", () => {
  it("detects extensionless files from magic bytes and text content", async () => {
    await expect(
      detectPreviewFile({ fileName: "document", content: Buffer.from("%PDF-1.7\n") })
    ).resolves.toMatchObject({ category: "pdf", mimeType: "application/pdf" });
    await expect(
      detectPreviewFile({ fileName: "messages", content: Buffer.from("Jul 27 host service: ready\n") })
    ).resolves.toMatchObject({ category: "text" });
  });

  it("returns bounded text pages and full-file search matches", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "structured-preview-"));
    tempRoots.push(root);
    const sourcePath = path.join(root, "service.log");
    await fs.writeFile(sourcePath, Array.from({ length: 520 }, (_, index) => `line ${index + 1}${index === 345 ? " needle" : ""}`).join("\n"));

    const page = responseCapture();
    await expect(
      sendStructuredPreview(page.response, {
        requested: "text",
        fileName: "service.log",
        sourcePath,
        query: { offset: "200", limit: "200" }
      })
    ).resolves.toBe(true);
    expect(page.state.body).toMatchObject({
      kind: "text",
      offset: 200,
      hasPrevious: true,
      hasNext: true,
      totalLinesKnown: false
    });
    expect((page.state.body as { lines: Array<{ number: number }> }).lines).toHaveLength(200);
    expect((page.state.body as { lines: Array<{ number: number }> }).lines[0]?.number).toBe(201);

    const search = responseCapture();
    await sendStructuredPreview(search.response, {
      requested: "text",
      fileName: "service.log",
      sourcePath,
      query: { search: "needle" }
    });
    expect(search.state.body).toMatchObject({
      kind: "text",
      query: "needle",
      totalLinesKnown: true,
      lines: [{ number: 346, text: "line 346 needle" }]
    });
  });

  it("detects and decodes UTF-16 text without exposing a byte-order mark", async () => {
    const capture = responseCapture();
    await sendStructuredPreview(capture.response, {
      requested: "text",
      fileName: "settings.properties",
      content: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("name=Bailey", "utf16le")])
    });
    expect(capture.state.body).toMatchObject({
      kind: "text",
      encoding: "utf-16le",
      lines: [{ number: 1, text: "name=Bailey" }]
    });
  });

  it("lists every workbook sheet and returns only the requested row and column window", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(Array.from({ length: 180 }, (_, row) => Array.from({ length: 60 }, (_, column) => `R${row + 1}C${column + 1}`))),
      "Large"
    );
    for (let index = 2; index <= 8; index += 1) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[`Sheet ${index}`]]), `Sheet ${index}`);
    }
    const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const capture = responseCapture();
    await sendStructuredPreview(capture.response, {
      requested: "table",
      fileName: "report.xlsx",
      content,
      query: {
        sheet: "Large",
        row_offset: "100",
        row_limit: "25",
        column_offset: "40",
        column_limit: "10"
      }
    });
    const payload = capture.state.body as {
      sheets: unknown[];
      rows: string[][];
      totalRows: number;
      totalColumns: number;
      partial: boolean;
    };
    expect(payload.sheets).toHaveLength(8);
    expect(payload.rows).toHaveLength(25);
    expect(payload.rows[0]).toHaveLength(10);
    expect(payload.rows[0]?.[0]).toBe("R101C41");
    expect(payload).toMatchObject({ totalRows: 180, totalColumns: 60, partial: true });
  });

  it("returns CSV data through the same table preview contract", async () => {
    const capture = responseCapture();
    await sendStructuredPreview(capture.response, {
      requested: "table",
      fileName: "customers.csv",
      content: Buffer.from("SN,Name,Status\n1,Alpha,Open\n2,Beta,Closed\n")
    });
    expect(capture.state.body).toMatchObject({
      kind: "table",
      format: "csv",
      totalRows: 3,
      totalColumns: 3,
      rows: [
        ["SN", "Name", "Status"],
        ["1", "Alpha", "Open"],
        ["2", "Beta", "Closed"]
      ]
    });
  });

  it("renders Draw.io XML as inert SVG without preserving embedded markup", async () => {
    const drawio = `<?xml version="1.0"?><mxfile><diagram><mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="2" value="Safe &lt;script&gt;alert(1)&lt;/script&gt;" style="rounded=1;fillColor=#ffffff;" vertex="1" parent="1">
        <mxGeometry x="20" y="30" width="160" height="60" as="geometry"/>
      </mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    const capture = responseCapture();
    await sendStructuredPreview(capture.response, {
      requested: "diagram",
      fileName: "flow.drawio",
      content: Buffer.from(drawio)
    });
    const svg = String(capture.state.body);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Safe alert(1)");
    expect(svg).not.toContain("<script>");
    expect(capture.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("renders the compressed payload used by Draw.io files", async () => {
    const graph = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Compressed" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="50" as="geometry"/></mxCell></root></mxGraphModel>`;
    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(graph))).toString("base64");
    const capture = responseCapture();
    await sendStructuredPreview(capture.response, {
      requested: "diagram",
      fileName: "compressed.drawio",
      content: Buffer.from(`<mxfile><diagram>${compressed}</diagram></mxfile>`)
    });
    expect(String(capture.state.body)).toContain("Compressed");
  });
});
