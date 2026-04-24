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

function activeElementIsEditable(): boolean {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;

  const tagName = element.tagName.toLowerCase();
  if (tagName === "textarea" || tagName === "select") return true;
  if (element.getAttribute("role") === "textbox") return true;

  if (!(element instanceof HTMLInputElement)) return false;
  const type = element.type.toLowerCase();
  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
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

  if (activeElementIsEditable() || userIsSelectingText()) {
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

async function checkBuildVersion(): Promise<void> {
  if (!CURRENT_BUILD_ID || pendingBuildId) return;

  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) return;
    const data = (await response.json()) as ServerVersion;
    const serverBuildId = typeof data.buildId === "string" ? data.buildId.trim() : "";
    if (!serverBuildId || serverBuildId === CURRENT_BUILD_ID) return;

    pendingBuildId = serverBuildId;
    maybeRefreshForPendingVersion();
  } catch {
    // Version checks should never interrupt the app.
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
