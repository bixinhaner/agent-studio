import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CODEX_FALLBACK_BASE_INSTRUCTIONS, CODEX_FALLBACK_MODEL_FIELDS } from "./codex-fallback-model-info.js";

/** Config key Codex reads its model catalog from; it only takes effect as an app-server launch flag. */
export const CODEX_MODEL_CATALOG_CONFIG_KEY = "model_catalog_json";

const DEEPSEEK_CONTEXT_WINDOW_TOKENS = 1_000_000;
const DEEPSEEK_MODELS = [
  { slug: "deepseek-flash", description: "DeepSeek Flash" },
  { slug: "deepseek-v4-pro", description: "DeepSeek V4 Pro" }
];

/**
 * Codex has no metadata for DeepSeek models. Its fallback metadata caps the window at 272K and
 * ignores a larger `model_context_window`, so the only way to give DeepSeek its real 1M window is
 * a catalog entry. The entries copy the fallback (same instructions, tools and reasoning request)
 * and change only the window, so prompts and behaviour stay as they were.
 */
export function buildDeepSeekModelCatalog(): { models: Record<string, unknown>[] } {
  return {
    models: DEEPSEEK_MODELS.map((model, index) => ({
      ...CODEX_FALLBACK_MODEL_FIELDS,
      slug: model.slug,
      display_name: model.slug,
      description: model.description,
      base_instructions: CODEX_FALLBACK_BASE_INSTRUCTIONS,
      context_window: DEEPSEEK_CONTEXT_WINDOW_TOKENS,
      max_context_window: DEEPSEEK_CONTEXT_WINDOW_TOKENS,
      priority: index
    }))
  };
}

const writtenCatalogs = new Set<string>();

/** Writes the catalog under `root` (named by content hash) and returns its path. */
export function ensureDeepSeekModelCatalogFile(root: string): string {
  const content = `${JSON.stringify(buildDeepSeekModelCatalog())}\n`;
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const filePath = path.resolve(root, ".model-catalogs", `deepseek-${hash}.json`);
  if (writtenCatalogs.has(filePath) && existsSync(filePath)) return filePath;
  if (!existsSync(filePath)) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, content);
    renameSync(tempPath, filePath);
  }
  writtenCatalogs.add(filePath);
  return filePath;
}

/**
 * Codex applies `model_catalog_json` only when the app-server starts, not from thread config,
 * so the runtime passes it as a launch flag. A missing file is skipped: the thread then runs on
 * the fallback window instead of failing to start.
 */
export function codexModelCatalogLaunchArgs(config: Record<string, unknown> | undefined): string[] {
  const value = config?.[CODEX_MODEL_CATALOG_CONFIG_KEY];
  if (typeof value !== "string" || !value.trim() || !existsSync(value)) return [];
  return ["-c", `${CODEX_MODEL_CATALOG_CONFIG_KEY}=${JSON.stringify(value)}`];
}
