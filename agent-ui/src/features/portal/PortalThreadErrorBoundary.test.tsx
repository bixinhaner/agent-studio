import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalThreadErrorBoundary } from "./PortalThreadErrorBoundary";

const consoleError = vi.spyOn(console, "error");

function BrokenThread(): never {
  throw new Error("message lookup failed");
}

describe("PortalThreadErrorBoundary", () => {
  beforeEach(() => {
    consoleError.mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockReset();
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
});
