import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalThreadErrorBoundary } from "./PortalThreadErrorBoundary";

const consoleError = vi.spyOn(console, "error");

function BrokenThread(): never {
  throw new Error("message lookup failed");
}

// React re-renders a throwing tree once more in development, so failures are toggled explicitly.
function FlakyThread({ thread }: { thread: { broken: boolean } }) {
  if (thread.broken) throw new Error("transient render race");
  return <p>Thread ready</p>;
}

describe("PortalThreadErrorBoundary", () => {
  beforeEach(() => {
    consoleError.mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    consoleError.mockReset();
    vi.useRealTimers();
  });

  it("keeps a thread render failure inside the task area", () => {
    render(
      <PortalThreadErrorBoundary resetKey="thread-a" fallback={<p role="alert">Return to the folder</p>}>
        <BrokenThread />
      </PortalThreadErrorBoundary>
    );

    expect(screen.getByRole("alert").textContent).toContain("Return to the folder");
  });

  it("recovers when a different thread is mounted", () => {
    const view = render(
      <PortalThreadErrorBoundary resetKey="thread-a" fallback={<p role="alert">Thread unavailable</p>}>
        <BrokenThread />
      </PortalThreadErrorBoundary>
    );

    view.rerender(
      <PortalThreadErrorBoundary resetKey="thread-b" fallback={<p role="alert">Thread unavailable</p>}>
        <p>New task ready</p>
      </PortalThreadErrorBoundary>
    );

    expect(screen.getByText("New task ready")).toBeTruthy();
  });

  it("reports every caught failure with its component stack", () => {
    const onError = vi.fn();
    render(
      <PortalThreadErrorBoundary resetKey="thread-a" fallback={<p role="alert">Thread unavailable</p>} onError={onError}>
        <BrokenThread />
      </PortalThreadErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe("message lookup failed");
    expect(onError.mock.calls[0][1].componentStack).toContain("BrokenThread");
  });

  it("re-renders the same thread once by itself after a transient failure", () => {
    vi.useFakeTimers();
    const thread = { broken: true };
    render(
      <PortalThreadErrorBoundary resetKey="thread-a" autoRetryLimit={1} autoRetryDelayMs={300} fallback={<p role="alert">Thread unavailable</p>}>
        <FlakyThread thread={thread} />
      </PortalThreadErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    thread.broken = false;

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText("Thread ready")).toBeTruthy();
  });

  it("stops retrying automatically after the limit and offers a manual retry", () => {
    vi.useFakeTimers();
    const thread = { broken: true };
    const onError = vi.fn();
    render(
      <PortalThreadErrorBoundary
        resetKey="thread-a"
        autoRetryLimit={1}
        autoRetryDelayMs={300}
        onError={onError}
        fallback={({ retry }) => <button type="button" onClick={retry}>Show again</button>}
      >
        <FlakyThread thread={thread} />
      </PortalThreadErrorBoundary>
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onError).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Show again" })).toBeTruthy();

    thread.broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Show again" }));
    expect(screen.getByText("Thread ready")).toBeTruthy();
  });
});
