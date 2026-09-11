const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const runtimeDir = app.isPackaged ? path.join(process.resourcesPath, 'local-runtime') : path.join(__dirname, '../../local-bridge/runtime');
const { createExecutor } = require(path.join(runtimeDir, 'executor.cjs'));
const { runTransport } = require(path.join(runtimeDir, 'transport.cjs'));
const RELAY_URL = process.env.AGENT_STUDIO_RELAY_URL || 'https://aiagent.indonesiacentral.cloudapp.azure.com';
const PORTAL_URL = process.env.AGENT_STUDIO_PORTAL_URL || 'https://bailey.baicells.com/?view=workspace';
let mainWindow, tray, controller, loop, executor, quitting = false, ready = false;
let config = { relayUrl: RELAY_URL, token: '', deviceId: '', deviceName: os.hostname(), roots: [], paused: false };
let status = { connected: false, error: '' };
let pendingLinks = [];
const configPath = () => path.join(app.getPath('userData'), 'bridge.json');
async function saveConfig() {
  await fs.mkdir(path.dirname(configPath()), { recursive: true, mode: 0o700 });
  const persisted = { ...config };
  delete persisted.encryptedToken;
  if (safeStorage.isEncryptionAvailable() && config.token) { persisted.encryptedToken = safeStorage.encryptString(config.token).toString('base64'); delete persisted.token; }
  const temp = configPath() + '.tmp'; await fs.writeFile(temp, JSON.stringify(persisted, null, 2), { mode: 0o600 }); await fs.rename(temp, configPath());
}
function state() { return { paired: Boolean(config.token), deviceName: config.deviceName, deviceId: config.deviceId, roots: config.roots, paused: config.paused, version: app.getVersion(), ...status }; }
function emit() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bridge:state', state()); }
async function api(endpoint, init = {}) {
  const response = await fetch(config.relayUrl.replace(/\/$/, '') + endpoint, { ...init, headers: { 'content-type': 'application/json', ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) }, signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && endpoint !== '/api/local-bridge/agent/pair') { executor?.stopAll(); throw new Error('连接已失效，请在 Portal 重新连接这台电脑。'); }
  if (!response.ok) throw new Error(body.detail || `连接失败（${response.status}），正在重试`);
  return body;
}
async function startPolling() {
  if (loop || !config.token || config.paused) return;
  controller = new AbortController();
  loop = runTransport({ api, executor, signal: controller.signal, onStatus: next => { const changed = status.connected !== next.connected || status.error !== next.error; status = next; if (changed) emit(); } }).finally(() => { loop = undefined; });
}
async function stopPolling() { controller?.abort(); executor?.stopAll(); if (loop) await loop; status = { connected: false, error: '' }; emit(); }
async function chooseRoot(connectionId, returnUrl) {
  showWindow();
  const result = await dialog.showOpenDialog(mainWindow, { title: '选择要处理的文件夹', buttonLabel: '使用此文件夹', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) { if (connectionId) await api('/api/local-bridge/agent/complete', { method: 'POST', body: JSON.stringify({ connection_id: connectionId, root_id: null }) }); return null; }
  const canonical = await fs.realpath(result.filePaths[0]);
  const { root } = await api('/api/local-bridge/agent/roots', { method: 'POST', body: JSON.stringify({ path: canonical, label: path.basename(canonical) || canonical }) });
  config.roots = [...config.roots.filter(r => r.id !== root.id), root]; await saveConfig(); emit();
  if (connectionId) { await api('/api/local-bridge/agent/complete', { method: 'POST', body: JSON.stringify({ connection_id: connectionId, root_id: root.id }) }); await shell.openExternal(returnUrl || PORTAL_URL); }
  return root;
}
async function pair(code) {
  const result = await api('/api/local-bridge/agent/pair', { method: 'POST', body: JSON.stringify({ code, name: config.deviceName, platform: process.platform }) });
  if (config.deviceId !== result.device_id) config.roots = [];
  config.token = result.token; config.deviceId = result.device_id; config.paused = false; await saveConfig(); void startPolling(); emit();
  await chooseRoot(result.connection_id, result.return_url); return state();
}
function showWindow() { if (mainWindow) { mainWindow.show(); if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } }
async function handleLink(value) {
  if (!ready) { pendingLinks.push(value); return; }
  try {
    const url = new URL(value);
    if (url.protocol !== 'agent-studio:' || url.hostname !== 'connect') return;
    // The relay URL is local configuration, never taken from an untrusted deep link.
    const code = url.searchParams.get('code'); showWindow();
    if (code && /^[A-Fa-f0-9]{8,10}$/.test(code)) await pair(code);
  } catch (error) { status.error = error.message; emit(); }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => { showWindow(); const link = argv.find(v => v.startsWith('agent-studio://')); if (link) void handleLink(link); });
  app.on('open-url', (event, url) => { event.preventDefault(); void handleLink(url); });
  app.on('activate', showWindow);
  app.on('before-quit', () => { quitting = true; controller?.abort(); executor?.stopAll(); });
  app.whenReady().then(async () => {
    try { const saved = JSON.parse(await fs.readFile(configPath(), 'utf8')); config = { ...config, ...saved }; if (saved.encryptedToken) config.token = safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64')); } catch {}
    executor = createExecutor({ getRoots: () => config.roots, journalDir: path.join(app.getPath('userData'), 'requests'), chooseRoot, openPath: async target => { const error = await shell.openPath(target); if (error) throw new Error(error); } });
    if (process.defaultApp) app.setAsDefaultProtocolClient('agent-studio', process.execPath, [path.resolve(process.argv[1])]); else app.setAsDefaultProtocolClient('agent-studio');
    const brandIcon = nativeImage.createFromPath(path.join(__dirname, '../renderer/brand.png'));
    if (process.platform === 'darwin') app.dock?.setIcon(brandIcon);
    mainWindow = new BrowserWindow({ width: 900, height: 680, minWidth: 680, minHeight: 540, title: 'Agent Studio · 我的电脑', icon: brandIcon, backgroundColor: '#ffffff', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    const icon = nativeImage.createFromPath(path.join(__dirname, '../renderer/tray.png')).resize({ width: 22, height: 22 });
    tray = new Tray(icon); tray.setToolTip('Agent Studio · 我的电脑'); tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开我的电脑', click: showWindow }, { label: '打开 Portal', click: () => shell.openExternal(PORTAL_URL) }, { type: 'separator' }, { label: '退出', click: () => app.quit() }])); tray.on('click', showWindow);
    // Upgrade only roots already selected in the local 0.1 client.
    if (config.token) for (const old of config.roots.filter(r => typeof r === 'string')) { try { const { root } = await api('/api/local-bridge/agent/roots', { method: 'POST', body: JSON.stringify({ path: old, label: path.basename(old) }) }); config.roots = config.roots.map(r => r === old ? root : r); } catch {} }
    config.roots = config.roots.filter(r => typeof r === 'object'); await saveConfig();
    // Operational request receipts are short-lived and contain no file history.
    const receipts = path.join(app.getPath('userData'), 'requests');
    for (const entry of await fs.readdir(receipts).catch(() => [])) { const file = path.join(receipts, entry); const stat = await fs.stat(file).catch(() => null); if (stat && Date.now() - stat.mtimeMs > 7 * 86400000) await fs.rm(file, { force: true }); }
    ready = true; void startPolling();
    const argvLink = process.argv.find(v => v.startsWith('agent-studio://')); if (argvLink) pendingLinks.push(argvLink);
    for (const link of pendingLinks.splice(0)) await handleLink(link);
  });
}
ipcMain.handle('bridge:get-state', () => state());
ipcMain.handle('bridge:pair', (_event, code) => pair(String(code)));
ipcMain.handle('bridge:choose-root', () => chooseRoot());
ipcMain.handle('bridge:portal', () => shell.openExternal(PORTAL_URL));
ipcMain.handle('bridge:pause', async () => { config.paused = !config.paused; await saveConfig(); if (config.paused) { status = { connected: false, error: '' }; emit(); await stopPolling(); } else void startPolling(); emit(); return state(); });
ipcMain.handle('bridge:disconnect', async () => { await stopPolling(); config.token = ''; config.deviceId = ''; config.roots = []; config.paused = false; await saveConfig(); emit(); return state(); });
