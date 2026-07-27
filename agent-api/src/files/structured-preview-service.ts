import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";
import { Worker } from "node:worker_threads";
import { inflateRawSync } from "node:zlib";

import type { Response } from "express";
import { detect as detectCharacterEncoding } from "chardet";
import { XMLParser } from "fast-xml-parser";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".log", ".ndjson", ".jsonl", ".json", ".yaml", ".yml", ".xml", ".csv", ".tsv",
  ".md", ".markdown", ".conf", ".config", ".properties", ".ini", ".env", ".syslog", ".dbglog",
  ".messages", ".out", ".err", ".ps1", ".sh", ".bash", ".zsh", ".sql", ".js", ".jsx", ".ts",
  ".tsx", ".css", ".scss", ".py", ".java", ".go", ".rs", ".toml"
]);
const TABLE_EXTENSIONS = new Set([".xlsx", ".xls", ".xlsm", ".xlsb", ".ods", ".csv", ".tsv"]);
const DRAWIO_EXTENSIONS = new Set([".drawio", ".dio"]);
const MAX_TEXT_LINE_CHARS = 20_000;
const MAX_TEXT_PAGE_LINES = 500;
const MAX_SEARCH_MATCHES = 100;
const MAX_DRAWIO_BYTES = 10 * 1024 * 1024;
const MAX_DRAWIO_CELLS = 1_000;
const SPREADSHEET_WORKER_TIMEOUT_MS = 30_000;
const xlsxModulePath = createRequire(import.meta.url).resolve("xlsx");
let activeSpreadsheetWorkers = 0;
const spreadsheetWorkerWaiters: Array<() => void> = [];

export type StructuredPreviewMode = "auto" | "text" | "table" | "diagram";

export type StructuredPreviewInput =
  | { fileName: string; sourcePath: string; content?: never; mimeType?: string }
  | { fileName: string; content: Buffer; sourcePath?: never; mimeType?: string };

export type DetectedPreviewFile = {
  extension: string;
  mimeType: string;
  category: "text" | "table" | "diagram" | "pdf" | "image" | "office" | "binary";
};

type TextEncoding = string;

type TextLine = {
  number: number;
  text: string;
};

function extensionOf(fileName: string): string {
  return path.extname(path.basename(fileName)).toLowerCase();
}

function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
  if (sample.includes(0)) {
    return sample[0] === 0xff && sample[1] === 0xfe || sample[0] === 0xfe && sample[1] === 0xff;
  }
  let controls = 0;
  for (const byte of sample) {
    if (byte < 9 || byte > 13 && byte < 32) controls += 1;
  }
  return controls / sample.length < 0.02;
}

function detectEncoding(buffer: Buffer): TextEncoding {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return "utf-16le";
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return "utf-16be";
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return "utf-8";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, Math.min(buffer.length, 64 * 1024)));
    return "utf-8";
  } catch {
    const detected = detectCharacterEncoding(buffer.subarray(0, Math.min(buffer.length, 256 * 1024)));
    const normalized = detected?.trim().toLowerCase();
    const aliases: Record<string, string> = {
      ascii: "utf-8",
      "iso-8859-1": "windows-1252",
      "iso-8859-2": "iso-8859-2",
      "utf-16le": "utf-16le",
      "utf-16be": "utf-16be",
      gb18030: "gb18030",
      gb2312: "gb18030",
      big5: "big5",
      shift_jis: "shift_jis",
      windows_1252: "windows-1252",
      "windows-1252": "windows-1252"
    };
    return aliases[normalized || ""] || "windows-1252";
  }
}

function decodeBuffer(buffer: Buffer, encoding: TextEncoding): string {
  if (encoding === "utf-16be") {
    const copy = Buffer.from(buffer);
    for (let index = 0; index + 1 < copy.length; index += 2) {
      const left = copy[index]!;
      copy[index] = copy[index + 1]!;
      copy[index + 1] = left;
    }
    return copy.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (encoding === "utf-16le") return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  try {
    return new TextDecoder(encoding).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return buffer.toString("latin1").replace(/^\uFEFF/, "");
  }
}

function detectBuffer(fileName: string, mimeType: string, buffer: Buffer): DetectedPreviewFile {
  const extension = extensionOf(fileName);
  const suppliedMime = mimeType.trim().toLowerCase();
  const starts = (...bytes: number[]) => bytes.every((byte, index) => buffer[index] === byte);
  if (starts(0x25, 0x50, 0x44, 0x46)) return { extension, mimeType: "application/pdf", category: "pdf" };
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { extension, mimeType: "image/png", category: "image" };
  if (starts(0xff, 0xd8, 0xff)) return { extension, mimeType: "image/jpeg", category: "image" };
  if (buffer.subarray(0, 6).toString("ascii").startsWith("GIF8")) {
    return { extension, mimeType: "image/gif", category: "image" };
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension, mimeType: "image/webp", category: "image" };
  }
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    if (buffer.includes(Buffer.from("xl/workbook.xml"))) {
      return {
        extension,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        category: "table"
      };
    }
    if (buffer.includes(Buffer.from("word/document.xml"))) {
      return {
        extension,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        category: "office"
      };
    }
    if (buffer.includes(Buffer.from("ppt/presentation.xml"))) {
      return {
        extension,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        category: "office"
      };
    }
  }
  if (TABLE_EXTENSIONS.has(extension) || suppliedMime.includes("spreadsheet") || suppliedMime.includes("excel")) {
    return { extension, mimeType: suppliedMime || "application/vnd.ms-excel", category: "table" };
  }
  if (DRAWIO_EXTENSIONS.has(extension) || suppliedMime.includes("drawio")) {
    return { extension, mimeType: "application/vnd.jgraph.mxfile", category: "diagram" };
  }
  if (buffer.subarray(0, Math.min(buffer.length, 8 * 1024)).toString("utf8").match(/<(?:mxfile|mxGraphModel)\b/i)) {
    return { extension, mimeType: "application/vnd.jgraph.mxfile", category: "diagram" };
  }
  if (TEXT_EXTENSIONS.has(extension) || suppliedMime.startsWith("text/") || looksLikeText(buffer)) {
    return { extension, mimeType: suppliedMime || "text/plain; charset=utf-8", category: "text" };
  }
  if (suppliedMime.startsWith("image/")) return { extension, mimeType: suppliedMime, category: "image" };
  return { extension, mimeType: suppliedMime || "application/octet-stream", category: "binary" };
}

async function inputBuffer(input: StructuredPreviewInput): Promise<Buffer> {
  return input.content ?? fsp.readFile(input.sourcePath);
}

async function sampleBuffer(input: StructuredPreviewInput): Promise<Buffer> {
  if (input.content) {
    if (input.content.length <= 512 * 1024) return input.content;
    return Buffer.concat([
      input.content.subarray(0, 256 * 1024),
      input.content.subarray(input.content.length - 256 * 1024)
    ]);
  }
  const handle = await fsp.open(input.sourcePath, "r");
  try {
    const stat = await handle.stat();
    const head = Buffer.alloc(Math.min(stat.size, 256 * 1024));
    const headResult = await handle.read(head, 0, head.length, 0);
    if (stat.size <= 512 * 1024) return head.subarray(0, headResult.bytesRead);
    const tail = Buffer.alloc(256 * 1024);
    const tailResult = await handle.read(tail, 0, tail.length, Math.max(0, stat.size - tail.length));
    return Buffer.concat([head.subarray(0, headResult.bytesRead), tail.subarray(0, tailResult.bytesRead)]);
  } finally {
    await handle.close();
  }
}

export async function detectPreviewFile(input: StructuredPreviewInput): Promise<DetectedPreviewFile> {
  return detectBuffer(input.fileName, input.mimeType || "", await sampleBuffer(input));
}

function boundedLine(text: string): string {
  return text.length <= MAX_TEXT_LINE_CHARS ? text : `${text.slice(0, MAX_TEXT_LINE_CHARS)}…`;
}

async function readTextPreview(
  input: StructuredPreviewInput,
  query: { offset: number; limit: number; search: string }
) {
  const sample = await sampleBuffer(input);
  const encoding = detectEncoding(sample);
  const offset = Math.max(0, query.offset);
  const limit = Math.max(1, Math.min(MAX_TEXT_PAGE_LINES, query.limit));
  const search = query.search.trim().toLocaleLowerCase();
  const lines: TextLine[] = [];
  let totalLines = 0;
  let matchesTruncated = false;
  let complete = true;

  const accept = (rawLine: string) => {
    totalLines += 1;
    const text = boundedLine(rawLine.replace(/\r$/, ""));
    if (search) {
      if (text.toLocaleLowerCase().includes(search)) {
        if (lines.length < MAX_SEARCH_MATCHES) lines.push({ number: totalLines, text });
        else matchesTruncated = true;
      }
      return false;
    }
    if (totalLines > offset && lines.length <= limit) lines.push({ number: totalLines, text });
    return lines.length > limit;
  };

  if (input.content || encoding !== "utf-8") {
    const decoded = decodeBuffer(await inputBuffer(input), encoding);
    let start = 0;
    while (start <= decoded.length) {
      const end = decoded.indexOf("\n", start);
      const shouldStop = accept(decoded.slice(start, end < 0 ? decoded.length : end));
      if (shouldStop) {
        complete = false;
        break;
      }
      if (end < 0) break;
      start = end + 1;
    }
  } else {
    const stream = fs.createReadStream(input.sourcePath, { encoding: "utf8" });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of reader) {
      if (accept(line)) {
        complete = false;
        break;
      }
    }
  }

  const hasNext = !search && lines.length > limit;
  if (hasNext) lines.length = limit;
  return {
    kind: "text" as const,
    encoding,
    offset,
    limit,
    lines,
    totalLines: complete ? totalLines : null,
    totalLinesKnown: complete,
    hasPrevious: !search && offset > 0,
    hasNext,
    query: search || undefined,
    matchesTruncated: search ? matchesTruncated : undefined,
    sizeBytes: input.content?.length ?? (await fsp.stat(input.sourcePath!)).size,
    partial: Boolean(search || offset > 0 || hasNext)
  };
}

async function readTablePreview(
  input: StructuredPreviewInput,
  query: { sheet: string; rowOffset: number; rowLimit: number; columnOffset: number; columnLimit: number }
) {
  const content = await inputBuffer(input);
  // Keep synchronous workbook parsing and malformed-file failures outside the API event loop.
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    const XLSX = require(workerData.xlsxModulePath);
    try {
      const workbook = XLSX.read(Buffer.from(workerData.content), {
        type: "buffer", dense: false, cellDates: true, cellNF: false, cellStyles: false
      });
      const sheets = workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name];
        const range = worksheet && worksheet["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"]) : null;
        return { name, rowCount: range ? range.e.r + 1 : 0, columnCount: range ? range.e.c + 1 : 0 };
      });
      const query = workerData.query;
      const selectedSheet = sheets.some((sheet) => sheet.name === query.sheet) ? query.sheet : (sheets[0] && sheets[0].name || "");
      const worksheet = workbook.Sheets[selectedSheet];
      const dimensions = sheets.find((sheet) => sheet.name === selectedSheet) || { name: selectedSheet, rowCount: 0, columnCount: 0 };
      const rowOffset = Math.max(0, query.rowOffset);
      const columnOffset = Math.max(0, query.columnOffset);
      const rowLimit = Math.max(1, Math.min(250, query.rowLimit));
      const columnLimit = Math.max(1, Math.min(100, query.columnLimit));
      const rowEnd = Math.min(dimensions.rowCount, rowOffset + rowLimit);
      const columnEnd = Math.min(dimensions.columnCount, columnOffset + columnLimit);
      const rows = [];
      for (let row = rowOffset; row < rowEnd; row += 1) {
        const values = [];
        for (let column = columnOffset; column < columnEnd; column += 1) {
          const cell = worksheet && worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
          values.push(cell ? String(XLSX.utils.format_cell(cell)) : "");
        }
        rows.push(values);
      }
      parentPort.postMessage({
        kind: "table",
        format: workerData.format,
        sheets, selectedSheet, rowOffset, rowLimit, columnOffset, columnLimit, rows,
        totalRows: dimensions.rowCount,
        totalColumns: dimensions.columnCount,
        hasPreviousRows: rowOffset > 0,
        hasNextRows: rowEnd < dimensions.rowCount,
        hasPreviousColumns: columnOffset > 0,
        hasNextColumns: columnEnd < dimensions.columnCount,
        partial: rowOffset > 0 || columnOffset > 0 || rowEnd < dimensions.rowCount || columnEnd < dimensions.columnCount
      });
    } catch (error) {
      parentPort.postMessage({ error: error && error.message ? error.message : String(error) });
    }
  `;
  if (activeSpreadsheetWorkers >= 2) {
    await new Promise<void>((resolve) => spreadsheetWorkerWaiters.push(resolve));
  }
  activeSpreadsheetWorkers += 1;
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        xlsxModulePath,
        content,
        query,
        format: extensionOf(input.fileName).replace(/^\./, "") || "spreadsheet"
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4
      }
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Spreadsheet preview timed out"));
    }, SPREADSHEET_WORKER_TIMEOUT_MS);
    timer.unref();
    worker.once("message", (message: Record<string, unknown>) => {
      clearTimeout(timer);
      void worker.terminate();
      if (typeof message.error === "string") reject(new Error(message.error));
      else resolve(message);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Spreadsheet preview worker exited with code ${code}`));
      }
    });
    });
  } finally {
    activeSpreadsheetWorkers = Math.max(0, activeSpreadsheetWorkers - 1);
    spreadsheetWorkerWaiters.shift()?.();
  }
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(value: unknown): string {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function styleValue(style: string, key: string, fallback: string): string {
  const match = style.match(new RegExp(`(?:^|;)${key}=([^;]+)`));
  const value = match?.[1]?.trim() || "";
  return /^(?:#[0-9a-f]{3,8}|[a-z]+)$/i.test(value) ? value : fallback;
}

function parseDrawioGraphModel(xml: string): Record<string, unknown> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "#text",
    parseTagValue: false
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const mxfile = parsed.mxfile as Record<string, unknown> | undefined;
  const diagramValue = mxfile?.diagram;
  const diagram = Array.isArray(diagramValue) ? diagramValue[0] : diagramValue;
  if (diagram && typeof diagram === "object" && "mxGraphModel" in diagram) {
    return (diagram as Record<string, unknown>).mxGraphModel as Record<string, unknown>;
  }
  if (typeof diagram === "string" || typeof diagram === "object" && diagram) {
    const text = (
      typeof diagram === "string"
        ? diagram
        : String((diagram as Record<string, unknown>)["#text"] || "")
    ).trim();
    if (text) {
      const inflated = inflateRawSync(Buffer.from(text, "base64")).toString("utf8");
      const decoded = decodeURIComponent(inflated);
      const inner = parser.parse(decoded) as Record<string, unknown>;
      return inner.mxGraphModel as Record<string, unknown>;
    }
  }
  if (parsed.mxGraphModel && typeof parsed.mxGraphModel === "object") {
    return parsed.mxGraphModel as Record<string, unknown>;
  }
  throw new Error("The Draw.io file does not contain a readable diagram");
}

function drawioToSvg(buffer: Buffer): string {
  if (buffer.length > MAX_DRAWIO_BYTES) throw new Error("The Draw.io file is too large to preview");
  const model = parseDrawioGraphModel(buffer.toString("utf8"));
  const root = model.root as Record<string, unknown> | undefined;
  const rawCells = root?.mxCell;
  const cells = (Array.isArray(rawCells) ? rawCells : rawCells ? [rawCells] : [])
    .filter((cell): cell is Record<string, unknown> => Boolean(cell && typeof cell === "object"))
    .slice(0, MAX_DRAWIO_CELLS);
  const vertices: Array<{ id: string; x: number; y: number; width: number; height: number; label: string; style: string }> = [];
  const edges: Array<{ source: string; target: string; label: string }> = [];
  for (const cell of cells) {
    const id = String(cell.id || "");
    if (String(cell.vertex || "") === "1") {
      const geometry = cell.mxGeometry as Record<string, unknown> | undefined;
      vertices.push({
        id,
        x: Number(geometry?.x || 0),
        y: Number(geometry?.y || 0),
        width: Math.max(20, Number(geometry?.width || 120)),
        height: Math.max(20, Number(geometry?.height || 60)),
        label: stripHtml(cell.value),
        style: String(cell.style || "")
      });
    } else if (String(cell.edge || "") === "1") {
      edges.push({ source: String(cell.source || ""), target: String(cell.target || ""), label: stripHtml(cell.value) });
    }
  }
  const minX = Math.min(0, ...vertices.map((cell) => cell.x - 40));
  const minY = Math.min(0, ...vertices.map((cell) => cell.y - 40));
  const maxX = Math.max(800, ...vertices.map((cell) => cell.x + cell.width + 40));
  const maxY = Math.max(600, ...vertices.map((cell) => cell.y + cell.height + 40));
  const byId = new Map(vertices.map((cell) => [cell.id, cell]));
  const edgeSvg = edges.map((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return "";
    const x1 = source.x + source.width / 2;
    const y1 = source.y + source.height / 2;
    const x2 = target.x + target.width / 2;
    const y2 = target.y + target.height / 2;
    return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>${edge.label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-size="12" fill="#475569">${escapeXml(edge.label)}</text>` : ""}</g>`;
  }).join("");
  const vertexSvg = vertices.map((cell) => {
    const fill = styleValue(cell.style, "fillColor", "#ffffff");
    const stroke = styleValue(cell.style, "strokeColor", "#64748b");
    const shape = cell.style.includes("ellipse")
      ? `<ellipse cx="${cell.x + cell.width / 2}" cy="${cell.y + cell.height / 2}" rx="${cell.width / 2}" ry="${cell.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
      : `<rect x="${cell.x}" y="${cell.y}" width="${cell.width}" height="${cell.height}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    return `<g>${shape}<foreignObject x="${cell.x + 8}" y="${cell.y + 6}" width="${Math.max(4, cell.width - 16)}" height="${Math.max(4, cell.height - 12)}"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;text-align:center;font:14px sans-serif;color:#0f172a;overflow:hidden">${escapeXml(cell.label)}</div></foreignObject></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" role="img"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#f8fafc"/>${edgeSvg}${vertexSvg}</svg>`;
}

function intQuery(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(typeof value === "string" ? value : "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function sendStructuredPreview(
  res: Response,
  input: StructuredPreviewInput & { requested?: StructuredPreviewMode; query?: Record<string, unknown> }
): Promise<boolean> {
  if (!input.requested) return false;
  const detected = await detectPreviewFile(input);
  const mode = input.requested === "auto"
    ? detected.category === "text" ? "text"
      : detected.category === "table" ? "table"
        : detected.category === "diagram" ? "diagram"
          : undefined
    : input.requested;
  if (!mode) return false;

  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (mode === "text") {
    if (detected.category !== "text") return false;
    const payload = await readTextPreview(input, {
      offset: intQuery(input.query?.offset, 0),
      limit: intQuery(input.query?.limit, 200),
      search: typeof input.query?.search === "string" ? input.query.search : ""
    });
    res.status(200).json(payload);
    return true;
  }
  if (mode === "table") {
    if (detected.category !== "table") return false;
    const payload = await readTablePreview(input, {
      sheet: typeof input.query?.sheet === "string" ? input.query.sheet : "",
      rowOffset: intQuery(input.query?.row_offset, 0),
      rowLimit: intQuery(input.query?.row_limit, 100),
      columnOffset: intQuery(input.query?.column_offset, 0),
      columnLimit: intQuery(input.query?.column_limit, 40)
    });
    res.status(200).json(payload);
    return true;
  }
  if (mode === "diagram") {
    if (detected.category !== "diagram") return false;
    const svg = drawioToSvg(await inputBuffer(input));
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.type("image/svg+xml").status(200).send(svg);
    return true;
  }
  return false;
}

export async function detectedContentType(input: StructuredPreviewInput): Promise<string> {
  return (await detectPreviewFile(input)).mimeType;
}
