import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchLayout } from "./use-workbench-layout";

let width = 1366;
let listeners: Set<() => void>;

function resize(nextWidth: number) {
  act(() => {
    width = nextWidth;
    listeners.forEach((listener) => listener());
  });
}

beforeEach(() => {
  width = 1366;
  listeners = new Set();
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return width <= Number(query.match(/max-width: (\d+)/)?.[1]); },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener)
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workbench session rail", () => {
  it("adapts to available width until the user makes a choice", () => {
    const { result } = renderHook(() => useWorkbenchLayout("user-a"));
    expect(result.current.layoutState.isSessionRailCollapsed).toBe(true);
    resize(1920);
    expect(result.current.layoutState.isSessionRailCollapsed).toBe(false);
    resize(1280);
    expect(result.current.layoutState.isSessionRailCollapsed).toBe(true);
  });

  it("preserves an explicit desktop choice through resize and reload", () => {
    const first = renderHook(() => useWorkbenchLayout("user-a"));
    act(() => first.result.current.toggleRail());
    resize(1024);
    expect(first.result.current.layoutState.isSessionRailCollapsed).toBe(false);
    first.unmount();
    const second = renderHook(() => useWorkbenchLayout("user-a"));
    expect(second.result.current.layoutState.isSessionRailCollapsed).toBe(false);
  });

  it("does not let mobile drawer actions overwrite the desktop choice", () => {
    const { result } = renderHook(() => useWorkbenchLayout("user-a"));
    act(() => result.current.toggleRail());
    resize(390);
    expect(result.current.layoutState.isSessionRailCollapsed).toBe(true);
    act(() => result.current.toggleRail());
    expect(result.current.layoutState.isSessionRailCollapsed).toBe(false);
    resize(1280);
    expect(result.current.layoutState.isSessionRailCollapsed).toBe(false);
  });

  it("isolates preferences between accounts", () => {
    const { result, rerender } = renderHook(({ id }) => useWorkbenchLayout(id), { initialProps: { id: "user-a" } });
    act(() => result.current.toggleRail());
    rerender({ id: "user-b" });
    expect(result.current.layoutState.isSessionRailCollapsed).toBe(true);
    rerender({ id: "user-a" });
    expect(result.current.layoutState.isSessionRailCollapsed).toBe(false);
  });

  it("keeps a choice during the session when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useWorkbenchLayout("user-a"));
    act(() => result.current.toggleRail());
    resize(1024);
    expect(result.current.layoutState.isSessionRailCollapsed).toBe(false);
  });
});
