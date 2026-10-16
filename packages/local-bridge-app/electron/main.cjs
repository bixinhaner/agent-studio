const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const runtimeDir = app.isPackaged ? path.join(process.resourcesPath, 'local-runtime') : path.join(__dirname, '../../local-bridge/runtime');
const { createExecutor } = require(path.join(runtimeDir, 'executor.cjs'));
const { runTransport } = require(path.join(runtimeDir, 'transport.cjs'));
const { createUpdater } = require('./updater.cjs');
const RELAY_URL = process.env.AGENT_STUDIO_RELAY_URL || 'https://aiagent.indonesiacentral.cloudapp.azure.com';
const PORTAL_URL = process.env.AGENT_STUDIO_PORTAL_URL || 'https://bailey.baicells.com/?view=workspace';
const ACTIVITY_LIMIT = 30;
let mainWindow, tray, controller, loop, executor, updater, quitting = false, ready = false;
let config = { relayUrl: RELAY_URL, token: '', deviceId: '', deviceName: os.hostname(), roots: [], paused: false, autoStartSet: false };
let status = { connected: false, error: '', pendingDeliveries: 0, deliveryError: '', running: 0 };
let authInvalid = false, lastWorkAt = 0;
let activity = [];
let pendingLinks = [];
const configPath = () => path.join(app.getPath('userData'), 'bridge.json');
async function saveConfig() {
  await fs.mkdir(path.dirname(configPath()), { recursive: true, mode: 0o700 });
  const persisted = { ...config };
  delete persisted.encryptedToken;
  if (safeStorage.isEncryptionAvailable() && config.token) { persisted.encryptedToken = safeStorage.encryptString(config.token).toString('base64'); delete persisted.token; }
  const temp = configPath() + '.tmp'; await fs.writeFile(temp, JSON.stringify(persisted, null, 2), { mode: 0o600 }); await fs.rename(temp, configPath());
}
const autoStartSupported = () => process.platform !== 'linux' && app.isPackaged;
function state() {
  return {
    paired: Boolean(config.token), deviceName: config.deviceName, deviceId: config.deviceId, roots: config.roots, paused: config.paused,
    version: app.getVersion(), platform: process.platform, authInvalid, activity,
    autoStart: autoStartSupported() ? app.getLoginItemSettings().openAtLogin : null,
    update: updater?.state || null,
    ...status
  };
}
function emit() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bridge:state', state()); refreshTray(); }
async function api(endpoint, init = {}) {
  let response;
  try {
    response = await fetch(config.relayUrl.replace(/\/$/, '') + endpoint, { ...init, headers: { 'content-type': 'application/json', 'x-local-bridge-version': app.getVersion(), ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) }, signal: AbortSignal.timeout(15000) });
  } catch (error) { throw Object.assign(new Error('网络连接中断，正在自动重试…'), { cause: error }); }
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && endpoint !== '/api/local-bridge/agent/pair') {
    executor?.stopAll();
    if (!authInvalid) { authInvalid = true; emit(); }
    throw Object.assign(new Error('这台电脑的连接已失效，请在 Bailey 网页重新连接。'), { status: 401 });
  }
  if (!response.ok) throw Object.assign(new Error(body.detail || `连接失败（${response.status}），正在重试`), { status: response.status });
  return body;
}
function recordActivity(event) {
  if (event.state === 'running' || event.finishedAt) lastWorkAt = Date.now();
  if (['choose_folder', 'cancel_task'].includes(event.op)) return;
  const existing = activity.findIndex(item => item.id === event.id);
  const item = { id: event.id, op: event.op, target: event.target, state: event.state, error: event.error || '', startedAt: event.startedAt, finishedAt: event.finishedAt || null };
  activity = existing >= 0 ? activity.map((old, i) => i === existing ? item : old) : [item, ...activity].slice(0, ACTIVITY_LIMIT);
  emit();
  if (event.state !== 'running') setTimeout(() => updater?.idle(), 1000);
}
function isIdle() {
  // Never restart for an update while Bailey is using this computer.
  return status.running === 0 && (executor?.runningProcesses() ?? 0) === 0 && Date.now() - lastWorkAt > 5 * 60000;
}
async function startPolling() {
  if (loop || !config.token || config.paused) return;
  authInvalid = false;
  controller = new AbortController();
  loop = runTransport({
    api, executor, signal: controller.signal, outboxDir: path.join(app.getPath('userData'), 'outbox'),
    onStatus: next => { status = { ...status, ...next }; emit(); },
    onActivity: recordActivity
  }).catch(error => { status = { ...status, connected: false, error: error.message }; emit(); }).finally(() => { loop = undefined; });
}
async function stopPolling() { controller?.abort(); executor?.stopAll(); if (loop) await loop; status = { ...status, connected: false, error: '', running: 0 }; emit(); }
async function chooseRoot(connectionId, returnUrl) {
  showWindow();
  const result = await dialog.showOpenDialog(mainWindow, { title: '选择要让 Bailey 处理的文件夹', buttonLabel: '使用此文件夹', properties: ['openDirectory', 'createDirectory'] });
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
  config.token = result.token; config.deviceId = result.device_id; config.paused = false; authInvalid = false;
  // Start with the computer by default after the first connection, so Bailey can reach it later.
  if (!config.autoStartSet && autoStartSupported()) { app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ['--hidden'] }); config.autoStartSet = true; }
  await saveConfig(); void startPolling(); emit();
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
function statusLabel() {
  if (!config.token) return '未连接';
  if (authInvalid) return '连接已失效';
  if (config.paused) return '已暂停';
  return status.connected ? (status.running ? `正在处理 ${status.running} 项操作` : '已连接') : '正在连接…';
}
async function togglePause() {
  config.paused = !config.paused; await saveConfig();
  if (config.paused) await stopPolling(); else void startPolling();
  emit(); return state();
}
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`Bailey 本机连接 · ${statusLabel()}`);
  const update = updater?.state;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `状态：${statusLabel()}`, enabled: false },
    { type: 'separator' },
    { label: '打开窗口', click: showWindow },
    { label: '打开 Bailey 网页', click: () => shell.openExternal(PORTAL_URL) },
    ...(config.token ? [{ label: config.paused ? '恢复连接' : '暂停连接', click: () => void togglePause() }] : []),
    ...(update?.status === 'ready' ? [{ label: `重启并更新到 ${update.latestVersion}`, click: () => void updater.install() }] : [{ label: '检查更新', click: () => void updater?.check({ manual: true }) }]),
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
}
async function confirm(message, detail, action) {
  const { response } = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: [action, '取消'], defaultId: 1, cancelId: 1, message, detail, noLink: true });
  return response === 0;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => { showWindow(); const link = argv.find(v => v.startsWith('agent-studio://')); if (link) void handleLink(link); });
  app.on('open-url', (event, url) => { event.preventDefault(); void handleLink(url); });
  app.on('activate', showWindow);
  app.on('before-quit', () => { quitting = true; controller?.abort(); executor?.stopAll(); updater?.stop(); });
  app.whenReady().then(async () => {
    try {
      const saved = JSON.parse(await fs.readFile(configPath(), 'utf8')); config = { ...config, ...saved };
      // A token that can no longer be decrypted (e.g. the OS keychain denied access) means reconnecting.
      if (saved.encryptedToken) { try { config.token = safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64')); } catch { config.token = ''; status.error = '无法读取已保存的连接，请在 Bailey 网页重新连接这台电脑。'; } }
    } catch {}
    executor = createExecutor({ getRoots: () => config.roots, journalDir: path.join(app.getPath('userData'), 'requests'), chooseRoot, version: app.getVersion(), openPath: async target => { const error = await shell.openPath(target); if (error) throw new Error(error); } });
    updater = createUpdater({
      currentVersion: app.getVersion(), baseUrl: `${config.relayUrl.replace(/\/$/, '')}/downloads/local-bridge`, updatesDir: path.join(app.getPath('userData'), 'updates'),
      quit: () => { quitting = true; app.quit(); }, isIdle, onState: () => emit(), openExternal: target => shell.openExternal(target)
    });
    if (process.defaultApp) app.setAsDefaultProtocolClient('agent-studio', process.execPath, [path.resolve(process.argv[1])]); else app.setAsDefaultProtocolClient('agent-studio');
    const brandIcon = nativeImage.createFromPath(path.join(__dirname, '../renderer/brand.png'));
    if (process.platform === 'darwin') app.dock?.setIcon(brandIcon);
    const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden;
    mainWindow = new BrowserWindow({ width: 920, height: 700, minWidth: 720, minHeight: 560, show: false, title: 'Bailey · 我的电脑', icon: brandIcon, backgroundColor: '#f6f6f7', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    if (!startHidden) mainWindow.show();
    const icon = nativeImage.createFromPath(path.join(__dirname, '../renderer/tray.png')).resize({ width: 22, height: 22 });
    tray = new Tray(icon); tray.on('click', showWindow); refreshTray();
    // Upgrade only roots already selected in the local 0.1 client.
    if (config.token) for (const old of config.roots.filter(r => typeof r === 'string')) { try { const { root } = await api('/api/local-bridge/agent/roots', { method: 'POST', body: JSON.stringify({ path: old, label: path.basename(old) }) }); config.roots = config.roots.map(r => r === old ? root : r); } catch {} }
    config.roots = config.roots.filter(r => typeof r === 'object'); await saveConfig();
    // Operational request receipts are short-lived and contain no file history.
    const receipts = path.join(app.getPath('userData'), 'requests');
    for (const entry of await fs.readdir(receipts).catch(() => [])) { const file = path.join(receipts, entry); const stat = await fs.stat(file).catch(() => null); if (stat && Date.now() - stat.mtimeMs > 7 * 86400000) await fs.rm(file, { force: true }); }
    ready = true; void startPolling();
    if (app.isPackaged) updater.start();
    const argvLink = process.argv.find(v => v.startsWith('agent-studio://')); if (argvLink) pendingLinks.push(argvLink);
    for (const link of pendingLinks.splice(0)) await handleLink(link);
  });
}
ipcMain.handle('bridge:get-state', () => state());
ipcMain.handle('bridge:pair', (_event, code) => pair(String(code)));
ipcMain.handle('bridge:choose-root', () => chooseRoot());
ipcMain.handle('bridge:portal', () => shell.openExternal(PORTAL_URL));
ipcMain.handle('bridge:pause', () => togglePause());
ipcMain.handle('bridge:disconnect', async () => {
  if (!await confirm('退出这台电脑的连接？', 'Bailey 将无法再使用这台电脑上的文件夹，正在运行的命令会停止。之后可在 Bailey 网页重新连接。', '退出连接')) return state();
  await stopPolling(); config.token = ''; config.deviceId = ''; config.roots = []; config.paused = false; authInvalid = false; activity = []; await saveConfig(); emit(); return state();
});
ipcMain.handle('bridge:open-root', async (_event, id) => { const root = config.roots.find(r => r.id === id); if (root) { const error = await shell.openPath(root.path); if (error) throw new Error(error); } });
ipcMain.handle('bridge:remove-root', async (_event, id) => {
  const root = config.roots.find(r => r.id === id); if (!root) return state();
  if (!await confirm(`从列表中移除“${root.label || root.path}”？`, '文件夹里的文件不会被删除。移除后，Bailey 不能再使用这个文件夹，需要时可以重新添加。', '移除')) return state();
  config.roots = config.roots.filter(r => r.id !== id); await saveConfig(); emit(); return state();
});
ipcMain.handle('bridge:stop-commands', async () => { executor?.stopAll(); emit(); return state(); });
ipcMain.handle('bridge:set-auto-start', async (_event, enabled) => { if (autoStartSupported()) { app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: true, args: ['--hidden'] }); config.autoStartSet = true; await saveConfig(); } emit(); return state(); });
ipcMain.handle('bridge:check-update', () => updater?.check({ manual: true }).then(() => state()));
ipcMain.handle('bridge:install-update', () => updater?.install());
ipcMain.handle('bridge:download-update', () => updater?.openDownload());
