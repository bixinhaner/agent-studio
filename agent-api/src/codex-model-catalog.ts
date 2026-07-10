import type { CodexModelCapability, CodexModelCatalog } from "./model-config.js";

type CatalogServiceDependencies = {
  listModels(): Promise<CodexModelCapability[]>;
  fallbackCatalog(): CodexModelCatalog;
  cacheTtlMs?: number;
};

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

export class CodexModelCatalogService {
  private cached?: { expiresAt: number; catalog: CodexModelCatalog };
  private inFlight?: Promise<CodexModelCatalog>;

  constructor(private readonly dependencies: CatalogServiceDependencies) {}

  async getCatalog(options: { refresh?: boolean; maxWaitMs?: number } = {}): Promise<CodexModelCatalog> {
    const now = Date.now();
    if (!options.refresh && this.cached && this.cached.expiresAt > now) {
      return this.cached.catalog;
    }

    const pending = this.inFlight ?? this.loadCatalog(now);
    this.inFlight = pending;
    void pending.finally(() => {
      if (this.inFlight === pending) this.inFlight = undefined;
    });

    const maxWaitMs = Number(options.maxWaitMs);
    if (Number.isFinite(maxWaitMs) && maxWaitMs >= 0) {
      return await Promise.race([
        pending,
        new Promise<CodexModelCatalog>((resolve) => {
          setTimeout(() => resolve({
            ...this.dependencies.fallbackCatalog(),
            warning: "Codex 模型目录正在后台刷新，当前使用内置兼容目录"
          }), maxWaitMs);
        })
      ]);
    }
    return await pending;
  }

  private async loadCatalog(now: number): Promise<CodexModelCatalog> {
    let catalog: CodexModelCatalog;
    try {
      const models = await this.dependencies.listModels();
      if (models.length === 0) throw new Error("Codex app-server returned an empty model catalog");
      catalog = {
        models,
        source: "app_server",
        fetchedAt: new Date(now).toISOString()
      };
    } catch (error) {
      catalog = {
        ...this.dependencies.fallbackCatalog(),
        warning: error instanceof Error ? error.message : "Codex model catalog is unavailable"
      };
    }

    this.cached = {
      expiresAt: now + (this.dependencies.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
      catalog
    };
    return catalog;
  }
}
