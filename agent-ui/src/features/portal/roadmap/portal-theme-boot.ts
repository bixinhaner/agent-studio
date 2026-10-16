/**
 * index.html marks the document with `data-portal-theme-boot="dark"` before
 * React mounts so dark-mode users do not see a white loading screen. Clear the
 * mark once the portal applies its real theme, or as soon as a non-portal
 * screen (sign-in, admin, review pages) renders.
 */
export const PORTAL_THEME_BOOT_ATTRIBUTE = "data-portal-theme-boot";

export function clearPortalThemeBoot(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root.hasAttribute(PORTAL_THEME_BOOT_ATTRIBUTE)) return;
  root.removeAttribute(PORTAL_THEME_BOOT_ATTRIBUTE);
  root.style.backgroundColor = "";
  root.style.colorScheme = "";
}
