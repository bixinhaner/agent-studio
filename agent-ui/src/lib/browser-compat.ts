type BrowserNavigator = Pick<Navigator, "userAgent" | "vendor">;

const SAFARI_USER_AGENT_PATTERN = /Safari\//;
const SAFARI_COMPATIBLE_BROWSER_PATTERN = /Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS/;

export function isSafariBrowser(
  browserNavigator: BrowserNavigator | null | undefined = typeof navigator === "undefined" ? undefined : navigator
): boolean {
  if (!browserNavigator) return false;

  return (
    browserNavigator.vendor === "Apple Computer, Inc." &&
    SAFARI_USER_AGENT_PATTERN.test(browserNavigator.userAgent) &&
    !SAFARI_COMPATIBLE_BROWSER_PATTERN.test(browserNavigator.userAgent)
  );
}
