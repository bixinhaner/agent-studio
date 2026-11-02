import { apiBase, authHeaders } from "./api";

/**
 * Tells the admin service that this signed-in user has the portal open, so operators
 * can see who was affected by an outage. Goes to /api/portal-presence (admin process),
 * keeps beating while the chat service is down, and never affects the page.
 */

export const PRESENCE_HEARTBEAT_MS = 4 * 60_000;
const MIN_BEAT_GAP_MS = 60_000;

function currentBuildId(): string | undefined {
  return typeof __AGENT_STUDIO_BUILD_ID__ === "string" ? __AGENT_STUDIO_BUILD_ID__ : undefined;
}

export function sendPortalPresence(): void {
  try {
    if (typeof fetch !== "function") return;
    void fetch(`${apiBase()}/api/portal-presence`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ build_id: currentBuildId() })
    }).catch(() => undefined);
  } catch {
    // Presence is best-effort.
  }
}

/** Beats now, every few minutes while the tab is visible, and when it becomes visible again. */
export function startPortalPresence(options: { send?: () => void; now?: () => number } = {}): () => void {
  const send = options.send ?? sendPortalPresence;
  const now = options.now ?? Date.now;
  let lastBeat = Number.NEGATIVE_INFINITY;
  const beat = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (now() - lastBeat < MIN_BEAT_GAP_MS) return;
    lastBeat = now();
    send();
  };
  beat();
  const timer = setInterval(beat, PRESENCE_HEARTBEAT_MS);
  const onVisibility = () => beat();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
