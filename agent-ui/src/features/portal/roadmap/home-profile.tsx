import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { fetchHomeProfile, type PortalHomeProfile } from "./api";

const HomeProfileContext = createContext<PortalHomeProfile | null>(null);

export function useHomeProfile(): PortalHomeProfile | null {
  return useContext(HomeProfileContext);
}

/** Loads the viewer's department-derived role once so the empty thread can show role starters. */
export function HomeProfileProvider(props: { enabled: boolean; userId?: string; children: ReactNode }) {
  const [profile, setProfile] = useState<PortalHomeProfile | null>(null);
  useEffect(() => {
    if (!props.enabled || !props.userId) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void fetchHomeProfile()
      .then((out) => !cancelled && setProfile(out))
      .catch(() => !cancelled && setProfile(null));
    return () => {
      cancelled = true;
    };
  }, [props.enabled, props.userId]);
  return <HomeProfileContext.Provider value={profile}>{props.children}</HomeProfileContext.Provider>;
}
