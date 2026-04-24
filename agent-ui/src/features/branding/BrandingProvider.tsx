import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { fetchPublicBranding } from "./api";
import {
  applyDocumentBranding,
  fallbackBrandingResponse,
  readStoredBrandingResponse,
  writeStoredBrandingResponse
} from "./runtime";
import type { PublicBranding, PublicPortalBehavior } from "./types";

type BrandingContextValue = {
  branding: PublicBranding;
  behavior: PublicPortalBehavior;
  loading: boolean;
  error: string;
  reload(): Promise<void>;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: PropsWithChildren) {
  const initial = readStoredBrandingResponse() ?? fallbackBrandingResponse();
  const [branding, setBranding] = useState<PublicBranding>(initial.branding);
  const [behavior, setBehavior] = useState<PublicPortalBehavior>(initial.behavior);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchPublicBranding();
      setBranding(response.branding);
      setBehavior(response.behavior);
      writeStoredBrandingResponse(response);
    } catch (nextError) {
      const fallback = readStoredBrandingResponse() ?? fallbackBrandingResponse();
      setBranding(fallback.branding);
      setBehavior(fallback.behavior);
      setError(nextError instanceof Error ? nextError.message : "Failed to load branding");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    applyDocumentBranding(branding);
  }, [branding]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      branding,
      behavior,
      loading,
      error,
      reload
    }),
    [behavior, branding, error, loading, reload]
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
