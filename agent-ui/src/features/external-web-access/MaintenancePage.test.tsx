// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MaintenancePage } from "./MaintenancePage";

function setBrowserLanguages(languages: string[]) {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MaintenancePage", () => {
  it("shows English for an English browser", async () => {
    setBrowserLanguages(["en-US"]);

    render(<MaintenancePage />);

    expect(
      screen.getByText("The system is currently under maintenance. Please try again later.")
    ).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en");
    });
  });

  it("shows Chinese for a Chinese browser", async () => {
    setBrowserLanguages(["zh-CN"]);

    render(<MaintenancePage />);

    expect(screen.getByText("系统维护中，请稍后再试。")).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("zh-CN");
    });
  });

  it("prefers the saved Portal language over the browser language", () => {
    setBrowserLanguages(["zh-CN"]);
    window.localStorage.setItem("agent-studio.portal.locale.v1", "en");

    render(<MaintenancePage />);

    expect(
      screen.getByText("The system is currently under maintenance. Please try again later.")
    ).toBeTruthy();
  });
});
