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
      <span>{t("thread.steerCouldNotApply")}</span>
      <span>{t("workspace.trashFolderTitle")}</span>
      <span>{t("workspace.trashFolderPermanentWarning")}</span>
      <span>{t("thread.connectionRecovering")}</span>
      <span>{t("thread.rerun")}</span>
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
    expect(screen.getByText("Couldn’t apply this direction")).toBeTruthy();
    expect(screen.getByText("Move folder to Trash?")).toBeTruthy();
    expect(screen.getByText(/conversation history, attachments, files, and version history/)).toBeTruthy();
    expect(screen.getByText("Connection interrupted. Recovering automatically…")).toBeTruthy();
    expect(screen.getByText("Run again")).toBeTruthy();
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
    expect(screen.getByText("未能应用这条引导")).toBeTruthy();
    expect(screen.getByText("将文件夹移到回收站？")).toBeTruthy();
    expect(screen.getByText(/相关会话记录、附件、文件及历史版本将自动永久删除/)).toBeTruthy();
    expect(screen.getByText("连接出现波动，正在自动恢复…")).toBeTruthy();
    expect(screen.getByText("重新执行")).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("zh-CN");
      expect(window.localStorage.getItem("agent-studio.portal.locale.v2:default")).toBe("zh-CN");
    });
  });

  it("locks a brand to its configured language when switching is disabled", async () => {
    window.localStorage.setItem("agent-studio.portal.locale.v1", "zh-CN");
    window.localStorage.setItem("agent-studio.portal.locale.v2:ranley", "zh-CN");

    render(
      <PortalI18nProvider brandKey="ranley" defaultLocale="en" languageSwitcherEnabled={false}>
        <LocaleProbe />
      </PortalI18nProvider>
    );

    expect(await screen.findByText("New session")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Chinese" }));
    expect(screen.getByText("New session")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("stores language choices separately for each brand", async () => {
    render(
      <PortalI18nProvider brandKey="customer-a" defaultLocale="zh-CN">
        <LocaleProbe />
      </PortalI18nProvider>
    );

    expect(await screen.findByText("新建会话")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to English" }));
    await waitFor(() => {
      expect(window.localStorage.getItem("agent-studio.portal.locale.v2:customer-a")).toBe("en");
      expect(window.localStorage.getItem("agent-studio.portal.locale.v2:customer-b")).toBeNull();
    });
  });
});
