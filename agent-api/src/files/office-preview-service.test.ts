import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OfficePreviewService, supportsOfficePdfPreview } from "./office-preview-service.js";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "office-preview-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("OfficePreviewService", () => {
  it("supports paginated document and presentation formats without claiming spreadsheets", () => {
    expect(supportsOfficePdfPreview("report.docx")).toBe(true);
    expect(supportsOfficePdfPreview("legacy.DOC")).toBe(true);
    expect(supportsOfficePdfPreview("slides.pptx")).toBe(true);
    expect(supportsOfficePdfPreview("drawing.odg")).toBe(true);
    expect(supportsOfficePdfPreview("network.vsdx")).toBe(true);
    expect(supportsOfficePdfPreview("table.xlsx")).toBe(false);
    expect(supportsOfficePdfPreview("notes.md")).toBe(false);
  });

  it("caches a converted preview and keeps the user-facing PDF name stable", async () => {
    const root = await tempRoot();
    let conversions = 0;
    const service = new OfficePreviewService({
      cacheRoot: path.join(root, "cache"),
      runConversion: async ({ sourcePath, outputDir }) => {
        conversions += 1;
        const outputName = `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`;
        await fs.writeFile(path.join(outputDir, outputName), Buffer.from("%PDF-test"));
      }
    });
    const content = Buffer.from("document version one");

    const first = await service.createPdfPreview({
      fileName: "季度报告.docx",
      content,
      fingerprint: "version-one"
    });
    const second = await service.createPdfPreview({
      fileName: "季度报告.docx",
      content,
      fingerprint: "version-one"
    });

    expect(first.fileName).toBe("季度报告.pdf");
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.buffer.toString()).toBe("%PDF-test");
    expect(conversions).toBe(1);
  });

  it("invalidates the cache when the source file changes", async () => {
    const root = await tempRoot();
    const sourcePath = path.join(root, "report.docx");
    await fs.writeFile(sourcePath, "version-one");
    let conversions = 0;
    const service = new OfficePreviewService({
      cacheRoot: path.join(root, "cache"),
      runConversion: async ({ sourcePath: copiedSource, outputDir }) => {
        conversions += 1;
        const outputName = `${path.basename(copiedSource, path.extname(copiedSource))}.pdf`;
        await fs.writeFile(path.join(outputDir, outputName), `%PDF-${conversions}`);
      }
    });

    await service.createPdfPreview({ fileName: "report.docx", sourcePath });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await fs.writeFile(sourcePath, "version-two-is-longer");
    const updated = await service.createPdfPreview({ fileName: "report.docx", sourcePath });

    expect(updated.cacheHit).toBe(false);
    expect(updated.buffer.toString()).toBe("%PDF-2");
    expect(conversions).toBe(2);
  });

  it("deduplicates concurrent conversion requests for the same file version", async () => {
    const root = await tempRoot();
    let conversions = 0;
    const service = new OfficePreviewService({
      cacheRoot: path.join(root, "cache"),
      runConversion: async ({ sourcePath, outputDir }) => {
        conversions += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        const outputName = `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`;
        await fs.writeFile(path.join(outputDir, outputName), "%PDF-shared");
      }
    });
    const input = {
      fileName: "slides.pptx",
      content: Buffer.from("same-slides"),
      fingerprint: "same-version"
    };

    const [first, second] = await Promise.all([
      service.createPdfPreview(input),
      service.createPdfPreview(input)
    ]);

    expect(first.buffer.equals(second.buffer)).toBe(true);
    expect(conversions).toBe(1);
  });
});
