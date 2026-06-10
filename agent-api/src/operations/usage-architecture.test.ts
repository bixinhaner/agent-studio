import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listProductionSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "temp"].includes(entry.name)) return [];
      return listProductionSourceFiles(fullPath);
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return [fullPath];
  });
}

function relativeSourcePath(filePath: string): string {
  return path.relative(sourceRoot, filePath).split(path.sep).join("/");
}

function matches(pattern: RegExp): string[] {
  return listProductionSourceFiles(sourceRoot)
    .filter((filePath) => pattern.test(fs.readFileSync(filePath, "utf8")))
    .map(relativeSourcePath)
    .sort();
}

describe("usage recording architecture", () => {
  it("keeps Codex usage recording behind the common recorder", () => {
    expect(matches(/recordCodexRuntimeUsage\s*\(/)).toEqual([
      "operations/usage-ingestion-service.ts",
      "operations/usage-recorder.ts"
    ]);
  });

  it("prevents business code from bypassing usage cost calculation and rollups", () => {
    expect(matches(/usageIngestion\.record\s*\(/)).toEqual(["operations/usage-recorder.ts"]);
    expect(matches(/(?:db|prisma)\.usageEvent\.create\s*\(/)).toEqual(["persistence/usage-event-repository.ts"]);
  });
});
