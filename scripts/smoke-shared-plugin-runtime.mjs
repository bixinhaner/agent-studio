#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const values = { runtimeRoot: "", pythonRoot: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--runtime-root" && argv[index + 1]) {
      values.runtimeRoot = path.resolve(argv[++index]);
    } else if (argv[index] === "--python-root" && argv[index + 1]) {
      values.pythonRoot = path.resolve(argv[++index]);
    } else {
      throw new Error(`unknown or incomplete argument: ${argv[index]}`);
    }
  }
  if (!values.runtimeRoot || !values.pythonRoot) {
    throw new Error("--runtime-root and --python-root are required");
  }
  return values;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  return result.stdout;
}

const args = parseArgs(process.argv.slice(2));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-studio-plugin-smoke-"));
try {
  const dependencies = path.join(args.runtimeRoot, "dependencies");
  const overrideBin = path.join(dependencies, "bin", "override");
  const nodeBin = path.join(dependencies, "node", "bin");
  const fallbackBin = path.join(dependencies, "bin", "fallback");
  const env = {
    ...process.env,
    HOME: path.join(tempRoot, "home"),
    XDG_CACHE_HOME: path.join(tempRoot, "cache"),
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    PATH: [overrideBin, nodeBin, process.env.PATH, fallbackBin].filter(Boolean).join(path.delimiter),
    PYTHONPATH: [args.pythonRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    NODE_PATH: [
      path.join(dependencies, "node", "node_modules"),
      process.env.NODE_PATH
    ].filter(Boolean).join(path.delimiter),
    FONTCONFIG_FILE: path.join(dependencies, "fontconfig", "fonts.conf")
  };
  fs.mkdirSync(env.HOME, { recursive: true });

  const graphSource = path.join(tempRoot, "graph.dot");
  const graphSvg = path.join(tempRoot, "graph.svg");
  fs.writeFileSync(graphSource, "digraph G { input -> output }");
  run("dot", ["-Tsvg", graphSource, "-o", graphSvg], { env, cwd: tempRoot });
  if (!fs.readFileSync(graphSvg, "utf8").includes("<svg")) throw new Error("Graphviz smoke produced no SVG");

  const ocrSource = path.join(tempRoot, "ocr.svg");
  const ocrImage = path.join(tempRoot, "ocr.png");
  fs.writeFileSync(
    ocrSource,
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="180"><rect width="100%" height="100%" fill="white"/><text x="30" y="120" font-family="Arial" font-size="86" fill="black">HELLO 123</text></svg>'
  );
  run("heif-convert", [ocrSource, ocrImage], { env, cwd: tempRoot });
  const ocrText = run("tesseract", [ocrImage, "stdout", "-l", "eng"], { env, cwd: tempRoot });
  if (!/HELLO\s+123/i.test(ocrText)) throw new Error(`OCR smoke mismatch: ${ocrText.trim()}`);

  const pythonScript = path.join(tempRoot, "office_smoke.py");
  fs.writeFileSync(pythonScript, `
import os
import subprocess
from docx import Document
from pptx import Presentation
from pptx.util import Inches
from pdf2image import convert_from_path

root = ${JSON.stringify(tempRoot)}
docx_path = os.path.join(root, "document-smoke.docx")
document = Document()
document.add_heading("Shared runtime document", level=1)
document.add_paragraph("Document render smoke test.")
document.save(docx_path)

pptx_path = os.path.join(root, "presentation-smoke.pptx")
presentation = Presentation()
slide = presentation.slides.add_slide(presentation.slide_layouts[5])
slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(1)).text_frame.text = "Shared runtime presentation"
presentation.save(pptx_path)

for source in (docx_path, pptx_path):
    subprocess.run(
        ["soffice", "--headless", "--convert-to", "pdf", "--outdir", root, source],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    pdf_path = os.path.splitext(source)[0] + ".pdf"
    pages = convert_from_path(pdf_path, dpi=72, first_page=1, last_page=1)
    if not pages or pages[0].width <= 0:
        raise RuntimeError("office render produced no raster page")
print("documents=ready presentations=ready")
`);
  const officeOutput = run("python3", [pythonScript], { env, cwd: tempRoot }).trim();

  const fontOutput = run("fc-match", ["Aptos", "--format=%{family}"], { env, cwd: tempRoot }).trim();
  if (!/Carlito|Aptos/i.test(fontOutput)) {
    throw new Error(`Office font alias smoke mismatch: ${fontOutput}`);
  }

  console.log(JSON.stringify({
    documents: "ready",
    presentations: "ready",
    graphviz: "ready",
    heifConvert: "ready",
    ocr: "ready",
    officeFonts: fontOutput,
    detail: officeOutput
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
