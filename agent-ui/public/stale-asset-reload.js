const key = "agent-studio:stale-asset-server-reload";
const cooldownMs = 5 * 60 * 1000;
const now = Date.now();
let recentlyReloaded = false;

try {
  const marker = JSON.parse(window.sessionStorage.getItem(key) || "null");
  recentlyReloaded =
    marker?.path === window.location.pathname &&
    typeof marker.at === "number" &&
    now - marker.at >= 0 &&
    now - marker.at < cooldownMs;

  if (!recentlyReloaded) {
    window.sessionStorage.setItem(key, JSON.stringify({ path: window.location.pathname, at: now }));
  }
} catch {
  recentlyReloaded = false;
}

if (!recentlyReloaded) {
  window.location.reload();
  await new Promise(() => {});
}

throw new Error("A stale application asset is no longer available. Refresh the page.");

