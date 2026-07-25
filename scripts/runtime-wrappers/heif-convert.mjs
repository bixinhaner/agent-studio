#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dependenciesRoot = path.resolve(scriptDir, "../..");
const nodeModules = path.join(dependenciesRoot, "node", "node_modules");
const requireFromRuntime = createRequire(path.join(nodeModules, "__runtime__.cjs"));
const sharp = requireFromRuntime("sharp");

function usage() {
  return "Usage: heif-convert <input.heic|input.heif> <output.png>";
}

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-version")) {
  console.log(`heif-convert (shared sharp ${sharp.versions?.sharp || "unknown"})`);
  process.exit(0);
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}
if (args.length !== 2) {
  console.error(usage());
  process.exit(2);
}

const input = path.resolve(args[0]);
const output = path.resolve(args[1]);
await fs.mkdir(path.dirname(output), { recursive: true });
await sharp(input, { limitInputPixels: false }).png().toFile(output);
console.log(`${input} => ${output}`);
