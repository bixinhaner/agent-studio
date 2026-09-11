import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "antd";
import { fetchLocalBridgeDevices, localBridgeApi, revokeLocalBridgeDevice } from "../api";
import { PortalI18nProvider, usePortalI18n, type PortalLocale } from "../i18n";
import { LocalWorkspaceContext, LocalWorkspaceControls, LocalWorkspaceDialogs, useLocalWorkspace } from "./LocalWorkspace";
vi.mock("../api", () => ({ fetchLocalBridgeDevices: vi.fn(), localBridgeApi: vi.fn(), revokeLocalBridgeDevice: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) });
  vi.mocked(fetchLocalBridgeDevices).mockResolvedValue([]);
  vi.mocked(localBridgeApi).mockResolvedValue({ binding: null });
});
function View({ visible, running = false }: { visible: boolean; running?: boolean }) {
  const local = useLocalWorkspace("", true);
  const { antdLocale, toggleLocale } = usePortalI18n();
  return <ConfigProvider locale={antdLocale}><LocalWorkspaceContext.Provider value={{ ...local, showEntry: visible, running }}>
    <button onClick={toggleLocale}>language</button><LocalWorkspaceControls /><LocalWorkspaceDialogs />
  </LocalWorkspaceContext.Provider></ConfigProvider>;
}
const view = (visible: boolean, locale: PortalLocale = "en", running = false) => <PortalI18nProvider defaultLocale={locale}><View visible={visible} running={running} /></PortalI18nProvider>;
const devices = [
  { id: 'mac', name: 'My MacBook', platform: 'darwin', status: 'online' as const, roots: [{ id: 'one', path: '/work/one', label: 'native-acceptance' }, { id: 'two', path: '/work/two', label: 'Second folder' }] },
  { id: 'linux', name: 'Crest', platform: 'linux-cli', status: 'offline' as const, roots: [{ id: 'three', path: '/work/linux', label: 'bailey-cli-acceptance' }] }
];

describe("unified local workspace menu", () => {
  it("hides the folder entry and open menus when the configured audience excludes the user", async () => {
    const { rerender } = render(view(false));
    expect(screen.queryByRole("button", { name: "Use a Computer Folder" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(view(true));
    fireEvent.click(screen.getByRole("button", { name: "Use a Computer Folder" }));
    await screen.findByRole('button', { name: 'Add Computer Folder…' });
    rerender(view(false));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add Computer Folder…' })).toBeNull());
  });
  it.each(["en", "zh-CN"] as const)("uses one localized add-folder entry for desktop, Linux and downloads: %s", async locale => {
    render(view(true, locale));
    const en = locale === "en";
    fireEvent.click(screen.getByRole("button", { name: en ? "Use a Computer Folder" : "使用电脑文件夹" }));
    const choose = await screen.findByRole("button", { name: en ? "Add Computer Folder…" : "添加电脑文件夹…" });
    expect(screen.queryByRole('button', { name: en ? 'My Computer' : '我的电脑' })).toBeNull();
    expect(screen.queryByRole('button', { name: en ? 'Choose Another Folder' : '选择其他文件夹' })).toBeNull();
    fireEvent.click(choose);
    await screen.findByRole("button", { name: en ? "Open App and Choose Folder" : "打开客户端并选择" });
    expect(screen.getByRole("button", { name: en ? "Linux CLI" : "Linux 命令行" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en ? "Download Desktop App" : "下载桌面客户端" }));
    expect(screen.getByRole("link", { name: en ? "macOS · Apple Silicon" : "macOS · Apple 芯片" })).toBeTruthy();
    expect(screen.getByRole("link", { name: en ? "Linux Desktop" : "Linux 桌面版" })).toBeTruthy();
  });
  it('groups folders by computer and switches existing folders and cloud directly', async () => {
    vi.mocked(fetchLocalBridgeDevices).mockResolvedValue(devices);
    render(view(true));
    fireEvent.click(screen.getByRole('button', { name: 'Use a Computer Folder' }));
    const mac = await screen.findByRole('region', { name: 'My MacBook' });
    expect(within(mac).getByRole('button', { name: 'native-acceptance' })).toBeTruthy();
    expect(within(mac).getByRole('button', { name: 'Second folder' })).toBeTruthy();
    expect(within(mac).queryByRole('button', { name: 'bailey-cli-acceptance' })).toBeNull();
    fireEvent.click(within(mac).getByRole('button', { name: 'native-acceptance' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use a Computer Folder' }).textContent).toContain('native-acceptance'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use a Computer Folder' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cloud Workspace' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use a Computer Folder' }).textContent).toBe('Cloud Workspace'));
    expect(localBridgeApi).not.toHaveBeenCalled();
  });
  it.each(['en', 'zh-CN'] as const)('removes the chosen computer from its secondary menu in %s', async locale => {
    vi.mocked(fetchLocalBridgeDevices).mockResolvedValue(devices);
    render(view(true, locale));
    const en = locale === 'en';
    fireEvent.click(screen.getByRole('button', { name: en ? 'Use a Computer Folder' : '使用电脑文件夹' }));
    fireEvent.click(await screen.findByRole('button', { name: en ? 'More actions for Crest' : 'Crest的更多操作' }));
    await screen.findByText(en ? 'Files on the computer will be kept.' : '不会删除电脑上的文件');
    fireEvent.click(screen.getByRole('menuitem', { name: en ? 'Remove Computer Connection' : '移除电脑连接' }));
    await waitFor(() => expect(revokeLocalBridgeDevice).toHaveBeenCalledWith('linux'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Crest' })).toBeNull());
    expect(screen.getByRole('region', { name: 'My MacBook' })).toBeTruthy();
  });
  it('keeps the device and offers retry when removal fails', async () => {
    vi.mocked(fetchLocalBridgeDevices).mockResolvedValue(devices);
    vi.mocked(revokeLocalBridgeDevice).mockRejectedValue(new Error('network'));
    render(view(true));
    fireEvent.click(screen.getByRole('button', { name: 'Use a Computer Folder' }));
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crest' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove Computer Connection' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('region', { name: 'Crest' })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('menuitem', { name: 'Remove Computer Connection' }) as HTMLButtonElement).disabled).toBe(false));
  });
  it('disables location changes and device removal while the task is running', async () => {
    vi.mocked(fetchLocalBridgeDevices).mockResolvedValue(devices);
    render(view(true, 'en', true));
    fireEvent.click(screen.getByRole('button', { name: 'Use a Computer Folder' }));
    await screen.findByRole('region', { name: 'My MacBook' });
    for (const name of ['Cloud Workspace', 'native-acceptance', 'Add Computer Folder…', 'More actions for Crest']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Stop the current task to switch folders.')).toBeTruthy();
  });
  it('closes with Escape, restores focus and switches language', async () => {
    render(view(true));
    const trigger = screen.getByRole('button', { name: 'Use a Computer Folder' });
    fireEvent.click(trigger);
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Add Computer Folder…' }), { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByText('language'));
    await screen.findByRole('button', { name: '使用电脑文件夹' });
  });
});
