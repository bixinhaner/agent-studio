import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activeElementHasTypedText,
  isRejectedAsOutdatedRequest,
  reloadIfOutdatedAfterRejectedSend,
  takeTextKeptForReload
} from "./build-version-refresh";

function stubServerBuild(buildId: string) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ buildId }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("build version refresh", () => {
  it("lets a focused but empty message box reload, but not one with typed text", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    expect(activeElementHasTypedText()).toBe(false);
    textarea.value = "still typing";
    expect(activeElementHasTypedText()).toBe(true);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.append(checkbox);
    checkbox.focus();
    expect(activeElementHasTypedText()).toBe(false);
  });

  it("treats removed routes and changed request bodies as an outdated page", () => {
    expect([400, 404, 405, 410, 422].every(isRejectedAsOutdatedRequest)).toBe(true);
    expect([401, 409, 429, 500, 502].some(isRejectedAsOutdatedRequest)).toBe(false);
  });

  it("reloads and keeps the unsent text when the server runs a newer build", async () => {
    stubServerBuild("newer-build");
    const reload = vi.fn();
    await expect(reloadIfOutdatedAfterRejectedSend("10月11那周的周报", reload)).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeTextKeptForReload()).toBe("10月11那周的周报");
    expect(takeTextKeptForReload()).toBe("");
  });

  it("leaves the error alone when the page is already the current build", async () => {
    stubServerBuild(__AGENT_STUDIO_BUILD_ID__);
    const reload = vi.fn();
    await expect(reloadIfOutdatedAfterRejectedSend("hello", reload)).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(takeTextKeptForReload()).toBe("");
  });

  it("does not reload when the version check fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const reload = vi.fn();
    await expect(reloadIfOutdatedAfterRejectedSend("hello", reload)).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
