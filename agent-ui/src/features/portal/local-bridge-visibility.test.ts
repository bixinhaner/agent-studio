import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { useLocalBridgeEntryVisibility } from "./local-bridge-visibility";

vi.mock("../../lib/api", () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("Portal entry visibility refresh", () => {
  it("hides during loading and refreshes published visibility on returning to the page", async () => {
    vi.mocked(api).mockResolvedValue({ local_bridge_visible: true });
    const { result } = renderHook(() => useLocalBridgeEntryVisibility("user-1"));
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    vi.mocked(api).mockResolvedValue({ local_bridge_visible: false });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("does not let an old user's delayed response reveal the next user's entry", async () => {
    let resolveOld!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue({ local_bridge_visible: false });
    const { result, rerender } = renderHook(({ id }) => useLocalBridgeEntryVisibility(id), { initialProps: { id: "old" } });
    rerender({ id: "next" });
    await act(async () => { resolveOld({ local_bridge_visible: true }); });
    expect(result.current).toBe(false);
  });

  it("does not load for signed-out users and hides when configuration is unavailable", async () => {
    vi.mocked(api).mockRejectedValue(new Error("offline"));
    const { result, rerender } = renderHook(({ id }: { id?: string }) => useLocalBridgeEntryVisibility(id), { initialProps: {} });
    expect(api).not.toHaveBeenCalled();
    rerender({ id: "user" });
    await act(async () => {});
    expect(result.current).toBe(false);
  });
});
