import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "antd";
import { fetchLocalBridgeDevices, localBridgeApi } from "../api";
import { PortalI18nProvider, usePortalI18n, type PortalLocale } from "../i18n";
import { LocalWorkspaceContext, LocalWorkspaceControls, LocalWorkspaceDialogs, useLocalWorkspace } from "./LocalWorkspace";
import { LocalBridgePanel } from "./LocalBridgePanel";
vi.mock("../api", () => ({ fetchLocalBridgeDevices: vi.fn(), localBridgeApi: vi.fn(), revokeLocalBridgeDevice: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) });
  vi.mocked(fetchLocalBridgeDevices).mockResolvedValue([]);
  vi.mocked(localBridgeApi).mockResolvedValue({ binding: null });
});
function View({ visible }: { visible: boolean }) {
  const local = useLocalWorkspace("", true);
  const [manage, setManage] = useState(false);
  const { antdLocale, toggleLocale } = usePortalI18n();
  return <ConfigProvider locale={antdLocale}><LocalWorkspaceContext.Provider value={{ ...local, showEntry: visible, running: false, manage: () => setManage(true) }}>
    <button onClick={toggleLocale}>language</button><LocalWorkspaceControls /><LocalWorkspaceDialogs /><LocalBridgePanel open={visible && manage} onClose={() => setManage(false)} />
  </LocalWorkspaceContext.Provider></ConfigProvider>;
}
const view = (visible: boolean, locale: PortalLocale = "en") => <PortalI18nProvider defaultLocale={locale}><View visible={visible} /></PortalI18nProvider>;

describe("local workspace visibility and localization", () => {
  it("hides the folder entry and dialogs when the configured audience excludes the user", () => {
    const { rerender } = render(view(false));
    expect(screen.queryByRole("button", { name: "Use a Computer Folder" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(view(true));
    expect(screen.getByRole("button", { name: "Use a Computer Folder" })).toBeTruthy();
    rerender(view(false));
    expect(screen.queryByRole("button", { name: "Use a Computer Folder" })).toBeNull();
  });
  it.each(["en", "zh-CN"] as const)("localizes folder selection and desktop connection flow: %s", async locale => {
    render(view(true, locale));
    const en = locale === "en";
    fireEvent.click(screen.getByRole("button", { name: en ? "Use a Computer Folder" : "使用电脑文件夹" }));
    const choose = await screen.findByRole("button", { name: en ? "Choose Another Folder" : "选择其他文件夹" });
    expect(screen.getByText(en ? "Recent" : "最近使用")).toBeTruthy();
    fireEvent.click(choose);
    await screen.findByRole("button", { name: en ? "Open App and Choose Folder" : "打开客户端并选择" });
    expect(screen.getByRole("button", { name: en ? "Linux CLI" : "Linux 命令行" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en ? "Download Desktop App" : "下载桌面客户端" }));
    expect(screen.getByRole("link", { name: en ? "macOS · Apple Silicon" : "macOS · Apple 芯片" })).toBeTruthy();
    expect(screen.getByRole("link", { name: en ? "Linux Desktop" : "Linux 桌面版" })).toBeTruthy();
  });
  it("translates the device panel and can switch languages without changing visibility", async () => {
    render(view(true));
    fireEvent.click(screen.getByRole("button", { name: "Use a Computer Folder" }));
    fireEvent.click(await screen.findByRole("button", { name: "My Computer" }));
    await screen.findByText("No Computers Connected");
    expect(screen.getByText("Commands run as your computer account. The selected folder is the default working directory.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("language"));
    await waitFor(() => expect(screen.getByRole("button", { name: "使用电脑文件夹" })).toBeTruthy());
  });
});
