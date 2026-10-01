import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "../i18n";
import { OnboardingTour } from "./OnboardingTour";

function visible(element: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  element.getBoundingClientRect = () =>
    ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => rect }) as DOMRect;
}

function Targets(props: { keys: string[] }) {
  return (
    <>
      {props.keys.map((key, index) => (
        <button
          key={key}
          type="button"
          data-tour={key}
          ref={(element) => {
            if (element) visible(element, { left: 400 + index * 40, top: 600, width: 32, height: 32 });
          }}
        >
          {key}
        </button>
      ))}
    </>
  );
}

function renderTour(keys: string[], extra: { prepare?(): void; onClose?(completed: boolean): void } = {}) {
  const onClose = extra.onClose ?? vi.fn();
  render(
    <PortalI18nProvider defaultLocale="en" languageSwitcherEnabled={false}>
      <Targets keys={keys} />
      <OnboardingTour open prepare={extra.prepare} onClose={onClose} />
    </PortalI18nProvider>
  );
  return onClose;
}

describe("OnboardingTour", () => {
  afterEach(() => cleanup());

  it("only walks steps whose targets are visible and finishes on the last one", async () => {
    const onClose = renderTour(["workspace", "attach", "steer", "outputs"]);
    expect(await screen.findByRole("dialog", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByText("1 / 4")).toBeTruthy();
    for (const title of ["Attachments", "Interject while it works", "Preview results"]) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(await screen.findByRole("dialog", { name: title })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("calls prepare before measuring and closes on Escape", async () => {
    const prepare = vi.fn();
    const onClose = renderTour(["workspace", "attach", "skills", "steer", "outputs"], { prepare });
    await screen.findByRole("dialog", { name: "Workspace" });
    expect(prepare).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await screen.findByRole("dialog", { name: "Attachments" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("falls back to centered cards for every step when no target is visible", async () => {
    renderTour([]);
    await waitFor(() => expect(screen.getByText("1 / 5")).toBeTruthy(), { timeout: 4000 });
    expect(document.querySelector(".roadmap-tour-backdrop")).toBeTruthy();
  });
});
