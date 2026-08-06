export function currentBrowserLocation(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function replaceBrowserLocation(nextLocation: string): void {
  window.history.replaceState({}, document.title, nextLocation);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
