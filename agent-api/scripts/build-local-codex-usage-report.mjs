import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const agentApiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(agentApiRoot, "..");
const entryPoint = path.join(agentApiRoot, "src", "ops", "local-codex-usage-report.ts");
const outputFile = path.join(repositoryRoot, "scripts", "codex-local-usage-report.mjs");

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await build({
  entryPoints: [entryPoint],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node18"],
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: [
      "#!/usr/bin/env node",
      "/**",
      " * Standalone Codex local usage and cost report.",
      " * Requires Node.js 18+ only; no npm install or repository checkout is needed.",
      " * Generated from agent-api/src/ops/local-codex-usage-report.ts.",
      " */"
    ].join("\n")
  }
});
await fs.chmod(outputFile, 0o755);

console.log(`Built ${path.relative(repositoryRoot, outputFile)}`);
