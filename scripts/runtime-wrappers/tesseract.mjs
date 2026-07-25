#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const executableDir = path.dirname(fileURLToPath(import.meta.url));
const dependenciesRoot = path.resolve(executableDir, "..", "..");
const require = createRequire(path.join(dependenciesRoot, "node", "package.json"));
const { createWorker, OEM } = require("tesseract.js");

function fail(message) {
  process.stderr.write(`tesseract: ${message}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  const version = require("tesseract.js/package.json").version;
  process.stdout.write(`tesseract ${version} (shared Tesseract.js runtime)\n`);
  process.exit(0);
}
if (args.length < 2 || args.includes("--help") || args.includes("-h")) {
  process.stdout.write("Usage: tesseract IMAGE OUTPUT_BASE [-l eng+chi_sim] [stdout]\n");
  process.exit(args.length < 2 ? 2 : 0);
}

const input = path.resolve(args[0]);
const outputBase = args[1];
if (!fs.existsSync(input)) fail(`input image does not exist: ${input}`);

let languages = "eng";
const languageIndex = args.indexOf("-l");
if (languageIndex >= 0) {
  languages = args[languageIndex + 1] || "";
}
const supported = new Set(["eng", "chi_sim"]);
const requested = languages.split("+").filter(Boolean);
if (requested.length === 0 || requested.some((language) => !supported.has(language))) {
  fail(`supported languages are eng and chi_sim; received: ${languages || "(empty)"}`);
}

const cachePath = path.join(
  process.env.XDG_CACHE_HOME || path.join(process.env.HOME || process.cwd(), ".cache"),
  "tesseract"
);
fs.mkdirSync(cachePath, { recursive: true });
const worker = await createWorker(languages, OEM.LSTM_ONLY, {
  langPath: path.join(dependenciesRoot, "tessdata"),
  cachePath,
  gzip: true,
  logger: () => {}
});
try {
  const result = await worker.recognize(input);
  const text = result.data.text;
  if (outputBase === "stdout") {
    process.stdout.write(text);
  } else {
    fs.writeFileSync(`${path.resolve(outputBase)}.txt`, text, "utf8");
  }
} finally {
  await worker.terminate();
}
