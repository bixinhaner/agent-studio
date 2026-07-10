import { describe, expect, it, vi } from "vitest";

import { CodexModelCatalogService } from "./codex-model-catalog.js";
import { fallbackModelCatalog, type CodexModelCapability } from "./model-config.js";

describe("CodexModelCatalogService", () => {
  it("caches runtime model capabilities", async () => {
    const listModels = vi.fn(async (): Promise<CodexModelCapability[]> => [
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6-Terra",
        description: "Balanced",
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high", "max"],
        inputModalities: ["text", "image"],
        serviceTiers: []
      }
    ]);
    const service = new CodexModelCatalogService({
      listModels,
      fallbackCatalog: fallbackModelCatalog,
      cacheTtlMs: 60_000
    });

    const first = await service.getCatalog();
    const second = await service.getCatalog();

    expect(first.source).toBe("app_server");
    expect(first.models[0]?.id).toBe("gpt-5.6-terra");
    expect(second).toEqual(first);
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("falls back without failing settings pages on an older app-server", async () => {
    const service = new CodexModelCatalogService({
      listModels: async () => { throw new Error("unsupported method model/list"); },
      fallbackCatalog: fallbackModelCatalog,
      cacheTtlMs: 60_000
    });

    const catalog = await service.getCatalog();

    expect(catalog.source).toBe("fallback");
    expect(catalog.warning).toContain("unsupported method model/list");
    expect(catalog.models.some((model) => model.id === "gpt-5.6-sol")).toBe(true);
  });

  it("returns a non-blocking fallback while one shared refresh continues", async () => {
    let resolveModels: ((models: CodexModelCapability[]) => void) | undefined;
    const listModels = vi.fn(() => new Promise<CodexModelCapability[]>((resolve) => {
      resolveModels = resolve;
    }));
    const service = new CodexModelCatalogService({
      listModels,
      fallbackCatalog: fallbackModelCatalog,
      cacheTtlMs: 60_000
    });

    const fallback = await service.getCatalog({ maxWaitMs: 1 });
    expect(fallback.source).toBe("fallback");
    expect(fallback.warning).toContain("后台刷新");

    resolveModels?.([{
      id: "gpt-5.6-terra",
      label: "GPT-5.6-Terra",
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
      inputModalities: ["text", "image"],
      serviceTiers: []
    }]);
    const refreshed = await service.getCatalog();

    expect(refreshed.source).toBe("app_server");
    expect(refreshed.models[0]?.id).toBe("gpt-5.6-terra");
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});
