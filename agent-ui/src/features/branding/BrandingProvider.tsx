import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { fetchPublicBranding } from "./api";
import { DEFAULT_BRANDING, type PublicBranding } from "./types";

type BrandingContextValue = {
  branding: PublicBranding;
  loading: boolean;
  error: string;
  reload(): Promise<void>;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

function applyFavicon(iconUrl: string) {
  if (typeof document === "undefined") return;
  const href = iconUrl.trim();
  if (!href) return;

  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

export function BrandingProvider({ children }: PropsWithChildren) {
  const [branding, setBranding] = useState<PublicBranding>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchPublicBranding();
      setBranding(response.branding);
    } catch (nextError) {
      setBranding(DEFAULT_BRANDING);
      setError(nextError instanceof Error ? nextError.message : "Failed to load branding");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    applyFavicon(branding.iconUrl || branding.logoUrl);
  }, [branding.iconUrl, branding.logoUrl]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      branding,
      loading,
      error,
      reload
    }),
    [branding, error, loading, reload]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  const value = useContext(BrandingContext);
  if (!value) {
    throw new Error("useBranding must be used within BrandingProvider");
  }
  return value;
}
