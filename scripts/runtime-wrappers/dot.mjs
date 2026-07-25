#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dependenciesRoot = path.resolve(scriptDir, "../..");
const nodeModules = path.join(dependenciesRoot, "node", "node_modules");
const requireFromRuntime = createRequire(path.join(nodeModules, "__runtime__.cjs"));
const { instance } = requireFromRuntime("@viz-js/viz");

function parseArgs(argv) {
  let format = "svg";
  let engine = path.basename(process.argv[1] || "dot");
  let output = "";
  let input = "";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "-V" || value === "--version") return { version: true };
    if (value === "-K" && argv[index + 1]) {
      engine = argv[++index];
      continue;
    }
    if (value.startsWith("-K") && value.length > 2) {
      engine = value.slice(2);
      continue;
    }
    if (value === "-T" && argv[index + 1]) {
      format = argv[++index];
      continue;
    }
    if (value.startsWith("-T") && value.length > 2) {
      format = value.slice(2).split(":")[0];
      continue;
    }
    if (value === "-o" && argv[index + 1]) {
      output = argv[++index];
      continue;
    }
    if (value.startsWith("-o") && value.length > 2) {
      output = value.slice(2);
      continue;
    }
    if (value.startsWith("-")) {
      throw new Error(`Unsupported Graphviz option: ${value}`);
    }
    if (input) throw new Error(`Only one input file is supported: ${value}`);
    input = value;
  }
  return { format, engine, output, input, version: false };
}

const args = parseArgs(process.argv.slice(2));
const viz = await instance();
if (args.version) {
  console.error(`dot - graphviz version ${viz.graphvizVersion} (shared wasm runtime)`);
  process.exit(0);
}
if (!viz.formats.includes(args.format)) {
  throw new Error(`Unsupported Graphviz output format: ${args.format}`);
}
if (!viz.engines.includes(args.engine)) {
  throw new Error(`Unsupported Graphviz layout engine: ${args.engine}`);
}

const source = args.input ? await fs.readFile(path.resolve(args.input), "utf8") : await new Promise((resolve, reject) => {
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    value += chunk;
  });
  process.stdin.on("end", () => resolve(value));
  process.stdin.on("error", reject);
});
const rendered = viz.renderString(source, { format: args.format, engine: args.engine });
if (args.output) {
  const output = path.resolve(args.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, rendered, "utf8");
} else {
  process.stdout.write(rendered);
}
