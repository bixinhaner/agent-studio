type RefreshActivityState = {
  hasRunningTasks: boolean;
  hasUnsavedDraft: boolean;
};

type ServerVersion = {
  buildId?: unknown;
};

const CURRENT_BUILD_ID = __AGENT_STUDIO_BUILD_ID__;
const VERSION_URL = "/version.json";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const VISIBLE_IDLE_REFRESH_MS = 5 * 60 * 1000;
const RUN_FINISHED_GRACE_MS = 60 * 1000;
const PENDING_RETRY_MAX_MS = 60 * 1000;
const TEXT_KEPT_FOR_RELOAD_KEY = "agent-studio:text-kept-for-reload";
const USER_ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "scroll", "touchstart", "focusin", "input"];

let installed = false;
let lastUserActivityAt = Date.now();
let runFinishedAt = 0;
let activityState: RefreshActivityState = {
  hasRunningTasks: false,
  hasUnsavedDraft: false
};
let pendingBuildId = "";
let retryTimer: number | undefined;

/**
 * Typing into a focused field holds the reload back. A focused but empty field does not: the
 * portal keeps its message box focused, so a visible tab would otherwise stay on an old release
 * for days and keep calling endpoints that no longer exist.
 */
export function activeElementHasTypedText(): boolean {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement) return element.value.trim() !== "";
  if (element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type)) return false;
    return element.value.trim() !== "";
  }
  if (element.isContentEditable || element.getAttribute("role") === "textbox") {
    return (element.textContent ?? "").trim() !== "";
  }
  return false;
}

function userIsSelectingText(): boolean {
  return Boolean(window.getSelection()?.toString().trim());
}

function clearRetryTimer(): void {
  if (retryTimer === undefined) return;
  window.clearTimeout(retryTimer);
  retryTimer = undefined;
}

function schedulePendingRetry(waitMs = PENDING_RETRY_MAX_MS): void {
  if (!pendingBuildId || retryTimer !== undefined) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    maybeRefreshForPendingVersion();
  }, Math.max(1000, Math.min(waitMs, PENDING_RETRY_MAX_MS)));
}

function reloadForNewVersion(): void {
  window.location.reload();
}

function safeVisibleRefreshDelay(): number {
  const now = Date.now();
  const idleWait = VISIBLE_IDLE_REFRESH_MS - (now - lastUserActivityAt);
  const runGraceWait = runFinishedAt > 0 ? RUN_FINISHED_GRACE_MS - (now - runFinishedAt) : 0;
  return Math.max(0, idleWait, runGraceWait);
}

function maybeRefreshForPendingVersion(): void {
  if (!pendingBuildId || typeof window === "undefined") return;

  if (activityState.hasRunningTasks || activityState.hasUnsavedDraft) {
    schedulePendingRetry();
    return;
  }

  if (document.hidden) {
    reloadForNewVersion();
    return;
  }

  if (activeElementHasTypedText() || userIsSelectingText()) {
    schedulePendingRetry();
    return;
  }

  const waitMs = safeVisibleRefreshDelay();
  if (waitMs > 0) {
    schedulePendingRetry(waitMs);
    return;
  }

  reloadForNewVersion();
}

async function fetchServerBuildId(): Promise<string> {
  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) return "";
    const data = (await response.json()) as ServerVersion;
    return typeof data.buildId === "string" ? data.buildId.trim() : "";
  } catch {
    // Version checks should never interrupt the app.
    return "";
  }
}

async function checkBuildVersion(): Promise<void> {
  if (!CURRENT_BUILD_ID || pendingBuildId) return;
  const serverBuildId = await fetchServerBuildId();
  if (!serverBuildId || serverBuildId === CURRENT_BUILD_ID) return;
  pendingBuildId = serverBuildId;
  maybeRefreshForPendingVersion();
}

/** HTTP statuses a newer release gives a request it no longer knows (removed route, changed body). */
const OUTDATED_PAGE_STATUSES = new Set([400, 404, 405, 410, 422]);

export function isRejectedAsOutdatedRequest(status: number): boolean {
  return OUTDATED_PAGE_STATUSES.has(status);
}

/**
 * A send the server rejected may come from a page that is an old release. When the server runs
 * a newer build, the unsent text is kept for the message box and the page reloads right away,
 * since the user is waiting on this send. Returns true when the reload has started.
 */
export async function reloadIfOutdatedAfterRejectedSend(
  unsentText: string,
  reload: () => void = reloadForNewVersion
): Promise<boolean> {
  if (!CURRENT_BUILD_ID || typeof window === "undefined") return false;
  const serverBuildId = await fetchServerBuildId();
  if (!serverBuildId || serverBuildId === CURRENT_BUILD_ID) return false;
  keepTextForReload(unsentText);
  reload();
  return true;
}

function keepTextForReload(text: string): void {
  if (!text.trim()) return;
  try {
    window.sessionStorage.setItem(TEXT_KEPT_FOR_RELOAD_KEY, text);
  } catch {
    // Without storage the text is lost, the reload still fixes sending.
  }
}

/** The text of a send that was interrupted by a version reload, returned once. */
export function takeTextKeptForReload(): string {
  try {
    const text = window.sessionStorage.getItem(TEXT_KEPT_FOR_RELOAD_KEY) ?? "";
    window.sessionStorage.removeItem(TEXT_KEPT_FOR_RELOAD_KEY);
    return text;
  } catch {
    return "";
  }
}

function markUserActivity(): void {
  lastUserActivityAt = Date.now();
  if (pendingBuildId) {
    clearRetryTimer();
    schedulePendingRetry(VISIBLE_IDLE_REFRESH_MS);
  }
}

export function reportAutoRefreshActivityState(next: Partial<RefreshActivityState>): void {
  const wasRunning = activityState.hasRunningTasks;
  activityState = {
    ...activityState,
    ...next
  };

  if (wasRunning && !activityState.hasRunningTasks) {
    runFinishedAt = Date.now();
    if (!document.hidden) {
      lastUserActivityAt = runFinishedAt;
    }
  }

  if (pendingBuildId) {
    clearRetryTimer();
    maybeRefreshForPendingVersion();
  }
}

export function installBuildVersionRefreshMonitor(): void {
  if (installed || typeof window === "undefined" || import.meta.env.DEV) return;
  installed = true;

  for (const eventName of USER_ACTIVITY_EVENTS) {
    window.addEventListener(eventName, markUserActivity, { capture: true, passive: true });
  }

  window.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      maybeRefreshForPendingVersion();
    } else {
      lastUserActivityAt = Date.now();
      void checkBuildVersion();
    }
  });
  window.addEventListener("focus", () => {
    lastUserActivityAt = Date.now();
    void checkBuildVersion();
  });
  window.addEventListener("online", () => {
    void checkBuildVersion();
  });

  window.setInterval(() => {
    void checkBuildVersion();
  }, CHECK_INTERVAL_MS);

  window.setTimeout(() => {
    void checkBuildVersion();
  }, 30 * 1000);
}
