import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  normalizePortalLocale,
  PortalI18nProvider,
  resolveInitialPortalLocale,
  usePortalI18n
} from "./i18n";

function LocaleProbe() {
  const { locale, t, toggleLocale } = usePortalI18n();
  return (
    <div>
      <span>{locale}</span>
      <span>{t("sessions.new")}</span>
      <button type="button" onClick={toggleLocale}>
        {t("language.switchTo")}
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "";
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

describe("portal i18n", () => {
  it("normalizes supported browser locale variants", () => {
    expect(normalizePortalLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizePortalLocale("en-GB")).toBe("en");
    expect(normalizePortalLocale("fr-FR")).toBeNull();
  });

  it("inherits the saved portal language and normalizes an English training URL", async () => {
    window.localStorage.setItem("agent-studio.portal.locale.v1", "en");
    window.history.replaceState(null, "", "/training");
    render(
      <PortalI18nProvider>
        <LocaleProbe />
      </PortalI18nProvider>
    );

    expect(await screen.findByText("New session")).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe("?lang=en"));
  });

  it("prefers a saved choice and otherwise falls back to a supported browser language", () => {
    expect(resolveInitialPortalLocale({ storedLocale: "en", browserLanguages: ["zh-CN"] })).toBe("en");
    expect(resolveInitialPortalLocale({ browserLanguages: ["fr-FR", "zh-TW"] })).toBe("zh-CN");
    expect(resolveInitialPortalLocale({ browserLanguages: ["fr-FR"] })).toBe("en");
  });

  it("switches copy, updates document language, and persists the choice", async () => {
    render(
      <PortalI18nProvider>
        <LocaleProbe />
      </PortalI18nProvider>
    );

    expect(screen.getByText("New session")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Chinese" }));

    expect(await screen.findByText("新建会话")).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("zh-CN");
      expect(window.localStorage.getItem("agent-studio.portal.locale.v1")).toBe("zh-CN");
    });
  });
});
