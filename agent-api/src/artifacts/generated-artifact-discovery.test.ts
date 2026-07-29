import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectGeneratedArtifactChanges,
  extractReferencedArtifactChanges,
  selectGeneratedArtifactChanges
} from "./generated-artifact-discovery.js";

const tempDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const parent = path.resolve(process.cwd(), "temp");
  await fs.mkdir(parent, { recursive: true });
  const workspace = await fs.mkdtemp(path.join(parent, "generated-artifact-discovery-"));
  tempDirectories.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("generated artifact discovery", () => {
  it("extracts local files from standard Codex references without path distortion", async () => {
    const workspace = await createWorkspace();
    const pdfPath = path.join(workspace, "output", "pdf", "health report.pdf");
    const deckPath = path.join(workspace, "outputs", "operations.pptx");
    const workbookPath = path.join(workspace, "deliverables", "status.xlsx");
    await Promise.all([
      fs.mkdir(path.dirname(pdfPath), { recursive: true }),
      fs.mkdir(path.dirname(deckPath), { recursive: true }),
      fs.mkdir(path.dirname(workbookPath), { recursive: true })
    ]);
    await Promise.all([
      fs.writeFile(pdfPath, "pdf"),
      fs.writeFile(deckPath, "pptx"),
      fs.writeFile(workbookPath, "xlsx")
    ]);

    const changes = extractReferencedArtifactChanges({
      workspacePath: workspace,
      text: [
        `[PDF](sandbox:${encodeURI(pdfPath)})`,
        `::codex-file-citation{path="${deckPath}" artifact_kind="presentation" slide_number="1"}`,
        `<file://${workbookPath}>`,
        "[remote](https://example.com/report.pdf)"
      ].join("\n")
    });

    expect(changes.map((change) => path.relative(workspace, change.path))).toEqual([
      path.join("outputs", "operations.pptx"),
      path.join("output", "pdf", "health report.pdf"),
      path.join("deliverables", "status.xlsx")
    ]);
  });

  it("scans singular and plural standard output directories", async () => {
    const workspace = await createWorkspace();
    const files = [
      path.join(workspace, "output", "report.pdf"),
      path.join(workspace, "outputs", "book.xlsx"),
      path.join(workspace, "artifacts", "document.docx"),
      path.join(workspace, "deliverables", "deck.pptx"),
      path.join(workspace, "exports", "data.csv"),
      path.join(workspace, "work", "builder.py")
    ];
    await Promise.all(files.map(async (file) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, file);
    }));

    const changes = await collectGeneratedArtifactChanges({
      workspacePath: workspace,
      allowedExtensions: [".pdf", ".xlsx", ".docx", ".pptx", ".csv", ".py"]
    });

    expect(changes.map((change) => path.relative(workspace, change.path)).sort()).toEqual([
      path.join("artifacts", "document.docx"),
      path.join("deliverables", "deck.pptx"),
      path.join("exports", "data.csv"),
      path.join("output", "report.pdf"),
      path.join("outputs", "book.xlsx")
    ].sort());
  });

  it("treats explicit final references as the delivery manifest", () => {
    const changes = selectGeneratedArtifactChanges({
      referencedChanges: [{ path: "/workspace/output/report.pdf", kind: "text_reference" }],
      runtimeChanges: [
        { path: "/workspace/build_report.py", kind: "create" },
        { path: "/workspace/output/report.pdf", kind: "create" }
      ],
      scannedChanges: [
        { path: "/workspace/output/report.pdf", kind: "workspace_scan" },
        { path: "/workspace/output/page-1.png", kind: "workspace_scan" }
      ]
    });

    expect(changes).toEqual([{ path: "/workspace/output/report.pdf", kind: "text_reference" }]);
  });

  it("prefers formally published artifacts over text references and fallback discovery", () => {
    const changes = selectGeneratedArtifactChanges({
      publishedChanges: [{
        path: "/workspace/outputs/final.pdf",
        kind: "published_artifact",
        metadata: { publicationRole: "final" }
      }],
      referencedChanges: [{ path: "/workspace/outputs/preview.png", kind: "text_reference" }],
      runtimeChanges: [{ path: "/workspace/build.py", kind: "create" }],
      scannedChanges: [{ path: "/workspace/outputs/preview.png", kind: "workspace_scan" }]
    });

    expect(changes).toEqual([{
      path: "/workspace/outputs/final.pdf",
      kind: "published_artifact",
      metadata: { publicationRole: "final" }
    }]);
  });

  it("keeps the final document ahead of large QA preview sets", async () => {
    const workspace = await createWorkspace();
    const output = path.join(workspace, "output");
    await fs.mkdir(output, { recursive: true });
    await Promise.all(Array.from({ length: 60 }, (_, index) =>
      fs.writeFile(path.join(output, `preview-${String(index).padStart(2, "0")}.png`), "preview")
    ));
    const report = path.join(output, "health-report.pdf");
    await fs.writeFile(report, "pdf");

    const changes = await collectGeneratedArtifactChanges({
      workspacePath: workspace,
      allowedExtensions: [".pdf", ".png"]
    });

    expect(changes).toHaveLength(50);
    expect(changes[0]?.path).toBe(report);
    expect(changes.some((change) => change.path === report)).toBe(true);
  });

  it("falls back to runtime changes and output scanning when no file is referenced", () => {
    const changes = selectGeneratedArtifactChanges({
      referencedChanges: [],
      runtimeChanges: [{ path: "/workspace/report.docx", kind: "create" }],
      scannedChanges: [{ path: "/workspace/output/report.pdf", kind: "workspace_scan" }]
    });

    expect(changes.map((change) => change.path)).toEqual([
      "/workspace/report.docx",
      "/workspace/output/report.pdf"
    ]);
  });
});
