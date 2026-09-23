import { useCallback, useEffect, useState } from "react";

import { useIsNarrowScreen } from "../../../lib/use-is-narrow-screen";
import { createInitialLayoutState } from "./layout-state";

function railPreferenceKey(userId: string) {
  return `agent-studio.portal.session-rail-collapsed.v1:${userId}`;
}

function readRailPreference(userId: string): boolean | undefined {
  if (!userId) return undefined;
  try {
    const stored = window.localStorage.getItem(railPreferenceKey(userId));
    return stored === "true" ? true : stored === "false" ? false : undefined;
  } catch {
    return undefined;
  }
}

/** Auto-fit until the user chooses a desktop layout; mobile drawers stay transient. */
export function useWorkbenchLayout(userId = "") {
  const isMobile = useIsNarrowScreen(768);
  const isNarrowDesktop = useIsNarrowScreen(1366);
  const [savedPreference, setSavedPreference] = useState(() => ({ userId, value: readRailPreference(userId) }));
  const preference = savedPreference.userId === userId ? savedPreference.value : readRailPreference(userId);
  const defaultCollapsed = isMobile || (preference ?? isNarrowDesktop);
  const [layoutState, setLayoutState] = useState(() => ({
    ...createInitialLayoutState(),
    isSessionRailCollapsed: defaultCollapsed
  }));

  useEffect(() => {
    setLayoutState((current) => current.isSessionRailCollapsed === defaultCollapsed
      ? current
      : { ...current, isSessionRailCollapsed: defaultCollapsed });
  }, [defaultCollapsed, isMobile, userId]);

  const toggleRail = useCallback(() => {
    const collapsed = !layoutState.isSessionRailCollapsed;
    setLayoutState((current) => ({ ...current, isSessionRailCollapsed: collapsed }));
    if (isMobile) return;
    setSavedPreference({ userId, value: collapsed });
    try {
      if (userId) window.localStorage.setItem(railPreferenceKey(userId), String(collapsed));
    } catch {
      // Keep the user's choice for this mount even when browser storage is unavailable.
    }
  }, [isMobile, layoutState.isSessionRailCollapsed, userId]);

  return { layoutState, setLayoutState, toggleRail };
}
