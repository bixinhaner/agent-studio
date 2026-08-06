import { afterEach, describe, expect, it, vi } from "vitest";

import { currentBrowserLocation, replaceBrowserLocation } from "./auth-navigation";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("auth navigation", () => {
  it("preserves the full location used for post-login redirects", () => {
    window.history.replaceState({}, "", "/training?view=workspace&folder=folder-1#message-2");

    expect(currentBrowserLocation()).toBe("/training?view=workspace&folder=folder-1#message-2");
  });

  it("notifies the client router after replacing the callback location", () => {
    window.history.replaceState({}, "", "/login/internal?code=callback-code&state=callback-state");
    const onPopState = vi.fn();
    window.addEventListener("popstate", onPopState);

    replaceBrowserLocation("/training?view=workspace&folder=folder-1");

    expect(window.location.pathname).toBe("/training");
    expect(window.location.search).toBe("?view=workspace&folder=folder-1");
    expect(onPopState).toHaveBeenCalledOnce();
    window.removeEventListener("popstate", onPopState);
  });
});
