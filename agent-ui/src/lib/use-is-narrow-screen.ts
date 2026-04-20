import { useEffect, useState } from "react";

function getMatches(maxWidth: number): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
}

export function isNarrowScreen(maxWidth = 980): boolean {
  return getMatches(maxWidth);
}

export function useIsNarrowScreen(maxWidth = 980): boolean {
  const [isNarrow, setIsNarrow] = useState<boolean>(() => getMatches(maxWidth));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;

    const mediaQuery = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = () => setIsNarrow(mediaQuery.matches);

    onChange();
    mediaQuery.addEventListener("change", onChange);
    return () => {
      mediaQuery.removeEventListener("change", onChange);
    };
  }, [maxWidth]);

  return isNarrow;
}
