import { describe, expect, it, vi } from "vitest";

import type { CodexModelCapability } from "./model-config.js";
import { applyModelDisplayNames, fetchProviderModelNames, readModelDisplayNames } from "./provider-model-labels.js";

function model(id: string): CodexModelCapability {
  return {
    id,
    label: id,
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "high"],
    inputModalities: ["text"],
    serviceTiers: []
  };
}

describe("fetchProviderModelNames", () => {
  it("reads display names from the provider's /models with the provider key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      object: "list",
      data: [
        { id: "deepseek-flash", object: "model", name: "DeepSeek-V4.1-Flash" },
        { id: "deepseek-v4-pro", object: "model", name: "DeepSeek-V4-Pro" },
        { id: "no-name", object: "model" }
      ]
    })));
    const names = await fetchProviderModelNames({ baseUrl: "https://api.deepseek.com/", apiKey: "test-key" }, fetchImpl as typeof fetch);
    expect(names).toEqual(new Map([["deepseek-flash", "DeepSeek-V4.1-Flash"], ["deepseek-v4-pro", "DeepSeek-V4-Pro"]]));
    expect(fetchImpl).toHaveBeenCalledWith("https://api.deepseek.com/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-key" })
    }));
  });

  it("returns no names when the provider fails or has no key", async () => {
    const failing = vi.fn(async () => { throw new Error("network down"); });
    expect((await fetchProviderModelNames({ baseUrl: "https://api.deepseek.com", apiKey: "k" }, failing as typeof fetch)).size).toBe(0);
    const unauthorized = vi.fn(async () => new Response("{}", { status: 401 }));
    expect((await fetchProviderModelNames({ baseUrl: "https://api.deepseek.com", apiKey: "k" }, unauthorized as typeof fetch)).size).toBe(0);
    const unused = vi.fn();
    expect((await fetchProviderModelNames({ baseUrl: "https://api.deepseek.com" }, unused as typeof fetch)).size).toBe(0);
    expect(unused).not.toHaveBeenCalled();
  });
});

describe("applyModelDisplayNames", () => {
  it("prefers the admin override, then the provider name, then Codex's label", () => {
    const overrides = readModelDisplayNames({
      modelDisplayNames: { "deepseek-flash": " DeepSeek-V4.1-Flash-1017 ", "deepseek-v4-pro": "  ", ignored: 3 }
    });
    const providerNames = new Map([["deepseek-flash", "DeepSeek-V4.1-Flash"], ["deepseek-v4-pro", "DeepSeek-V4-Pro"]]);
    const labelled = applyModelDisplayNames([model("deepseek-flash"), model("deepseek-v4-pro"), model("other")], { overrides, providerNames });
    expect(labelled.map((item) => item.label)).toEqual(["DeepSeek-V4.1-Flash-1017", "DeepSeek-V4-Pro", "other"]);
  });
});
