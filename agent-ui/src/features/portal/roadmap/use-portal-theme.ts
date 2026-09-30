import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

export type PortalThemePreference = "light" | "dark" | "system";
export type PortalResolvedTheme = "light" | "dark";

const STORAGE_KEY = "agent-studio.portal.theme.v1";

function readStoredPreference(): PortalThemePreference | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : undefined;
  } catch {
    return undefined;
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
}

/**
 * Portal theme preference. Local storage gives an instant first paint; the
 * server-side preference (when present) wins once the user is known so the
 * choice follows the account across devices.
 */
export function usePortalTheme(serverPreference?: PortalThemePreference) {
  const [preference, setPreferenceState] = useState<PortalThemePreference>(
    () => (typeof window === "undefined" ? "light" : readStoredPreference() ?? "light")
  );
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (serverPreference) setPreferenceState(serverPreference);
  }, [serverPreference]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  const resolved: PortalResolvedTheme = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.portalTheme = resolved;
    root.style.colorScheme = resolved;
    return () => {
      delete root.dataset.portalTheme;
      root.style.colorScheme = "";
    };
  }, [resolved]);

  const setPreference = useCallback((next: PortalThemePreference) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep the in-memory choice when storage is blocked.
    }
    const apply = () => setPreferenceState(next);
    const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (doc.startViewTransition && !reduceMotion) doc.startViewTransition(() => flushSync(apply));
    else apply();
  }, []);

  return { preference, resolved, setPreference };
}
