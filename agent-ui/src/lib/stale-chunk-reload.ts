const STALE_CHUNK_RELOAD_KEY = "agent-studio:stale-dynamic-import-reload";
const STALE_CHUNK_RELOAD_COOLDOWN_MS = 5 * 60 * 1000;

const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i
];

function currentReloadTarget(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function parseReloadMarker(value: string | null): { target: string; at: number } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { target?: unknown; at?: unknown };
    if (typeof parsed.target !== "string" || typeof parsed.at !== "number") return null;
    return { target: parsed.target, at: parsed.at };
  } catch {
    return null;
  }
}

function readReloadMarker(): { target: string; at: number } | null {
  try {
    return parseReloadMarker(window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY));
  } catch {
    return null;
  }
}

function writeReloadMarker(target: string): boolean {
  try {
    window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, JSON.stringify({ target, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function isDynamicImportLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function reloadOnceForStaleDynamicImport(): boolean {
  if (typeof window === "undefined") return false;

  const target = currentReloadTarget();
  const marker = readReloadMarker();
  const elapsedMs = marker ? Date.now() - marker.at : Number.POSITIVE_INFINITY;
  const recentlyReloaded =
    marker?.target === target && elapsedMs >= 0 && elapsedMs < STALE_CHUNK_RELOAD_COOLDOWN_MS;

  if (recentlyReloaded) return false;
  if (!writeReloadMarker(target)) return false;

  window.location.reload();
  return true;
}

export function installStaleDynamicImportReloadHandler(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceForStaleDynamicImport();
  });
}
