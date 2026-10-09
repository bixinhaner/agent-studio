/**
 * Per-user cap for best-effort browser reports: a fixed window count plus a short
 * duplicate filter, so a crash loop in one tab cannot flood logs or tables.
 */
export type ReportRateLimiterOptions = {
  now?: () => number;
  windowMs?: number;
  maxPerWindow?: number;
  duplicateWindowMs?: number;
  maxTrackedUsers?: number;
};

type UserWindow = { startedAt: number; count: number; recent: Map<string, number> };

export function createReportRateLimiter(options: ReportRateLimiterOptions = {}) {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 10 * 60 * 1000;
  const maxPerWindow = options.maxPerWindow ?? 20;
  const duplicateWindowMs = options.duplicateWindowMs ?? 60 * 1000;
  const maxTrackedUsers = options.maxTrackedUsers ?? 5000;
  const windows = new Map<string, UserWindow>();

  return {
    /** Returns the accept time, or undefined when the report should be dropped. */
    accept(userId: string, signature: string): number | undefined {
      const at = now();
      let window = windows.get(userId);
      if (!window || at - window.startedAt > windowMs) {
        if (!window && windows.size >= maxTrackedUsers) windows.clear();
        window = { startedAt: at, count: 0, recent: new Map() };
        windows.set(userId, window);
      }
      const lastSeen = window.recent.get(signature);
      if (window.count >= maxPerWindow || (lastSeen !== undefined && at - lastSeen < duplicateWindowMs)) {
        return undefined;
      }
      window.count += 1;
      window.recent.set(signature, at);
      return at;
    }
  };
}
