import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CODEX_FALLBACK_BASE_INSTRUCTIONS } from "./codex-fallback-model-info.js";
import { buildDeepSeekModelCatalog, codexModelCatalogLaunchArgs, ensureDeepSeekModelCatalogFile } from "./codex-deepseek-catalog.js";

describe("DeepSeek Codex model catalog", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it("keeps Codex's fallback prompt and tools and only raises the window to 1M", () => {
    const [flash] = buildDeepSeekModelCatalog().models;
    expect(flash).toMatchObject({
      slug: "deepseek-flash",
      base_instructions: CODEX_FALLBACK_BASE_INSTRUCTIONS,
      context_window: 1_000_000,
      max_context_window: 1_000_000,
      effective_context_window_percent: 95,
      apply_patch_tool_type: null,
      tool_mode: null,
      multi_agent_version: "v1",
      default_reasoning_summary: "auto",
      include_skills_usage_instructions: false,
      comp_hash: null
    });
  });

  it("writes the catalog once and passes it as an app-server launch flag", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "deepseek-catalog-"));
    roots.push(root);
    const file = ensureDeepSeekModelCatalogFile(root);
    expect(ensureDeepSeekModelCatalogFile(root)).toBe(file);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(buildDeepSeekModelCatalog());
    expect(codexModelCatalogLaunchArgs({ model_catalog_json: file })).toEqual(["-c", `model_catalog_json=${JSON.stringify(file)}`]);
  });

  it("starts without the flag when the catalog is missing or not configured", () => {
    expect(codexModelCatalogLaunchArgs(undefined)).toEqual([]);
    expect(codexModelCatalogLaunchArgs({ model_catalog_json: "/nonexistent/catalog.json" })).toEqual([]);
  });
});
