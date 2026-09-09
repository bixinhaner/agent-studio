const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const RELAY_URL = process.env.AGENT_STUDIO_RELAY_URL || "https://aiagent.indonesiacentral.cloudapp.azure.com";
let mainWindow;
let config = { relayUrl: RELAY_URL, token: "", deviceId: "", deviceName: os.hostname(), roots: [] };
let pollTimer;

function configPath() { return path.join(app.getPath("userData"), "bridge.json"); }
async function loadConfig() { try { config = { ...config, ...JSON.parse(await fs.readFile(configPath(), "utf8")) }; } catch {} }
async function saveConfig() { await fs.mkdir(path.dirname(configPath()), { recursive: true }); await fs.writeFile(configPath(), JSON.stringify(config, null, 2)); }
function emit(channel, payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }
async function api(endpoint, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers || {}) };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  const response = await fetch(`${config.relayUrl.replace(/\/$/, "")}${endpoint}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `请求失败（${response.status}）`);
  return body;
}
async function execute(command) {
  const canonical = await fs.realpath(command.path);
  const roots = command.scope.roots || [];
  if (!roots.some((root) => { const r = path.resolve(root); const p = path.resolve(canonical); return p === r || p.startsWith(`${r}${path.sep}`); })) throw new Error("BRIDGE_PATH_DENIED");
  if (command.op === "read") return { path: canonical, content: await fs.readFile(canonical, "utf8") };
  if (command.op === "list") return { path: canonical, entries: await fs.readdir(canonical) };
  if (typeof command.content !== "string" || Buffer.byteLength(command.content) > 10 * 1024 * 1024) throw new Error("BRIDGE_PAYLOAD_INVALID");
  await fs.writeFile(canonical, command.content, "utf8");
  return { path: canonical, written: true };
}
async function poll() {
  if (!config.token) return;
  try {
    const body = await api("/api/local-bridge/agent/poll", { method: "POST", body: "{}" });
    emit("bridge:status", { connected: true, roots: body.roots || config.roots });
    if (body.command) {
      let result;
      try { result = await execute(body.command); } catch (error) { result = { ok: false, error: error.message || "BRIDGE_ERROR" }; }
      await api("/api/local-bridge/agent/result", { method: "POST", body: JSON.stringify({ id: body.command.id, result }) });
    }
  } catch (error) { emit("bridge:status", { connected: false, error: error.message || "网络连接失败" }); }
}
function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(() => void poll(), 800); void poll(); }

ipcMain.handle("bridge:get-state", () => ({ ...config, connected: Boolean(config.token) }));
ipcMain.handle("bridge:pair", async (_event, code) => {
  const result = await api("/api/local-bridge/agent/pair", { method: "POST", body: JSON.stringify({ code, name: config.deviceName, platform: process.platform }) });
  config = { ...config, token: result.token, deviceId: result.device_id };
  await saveConfig(); startPolling(); emit("bridge:paired", { deviceId: config.deviceId, name: config.deviceName });
  return { deviceId: config.deviceId, name: config.deviceName };
});
ipcMain.handle("bridge:choose-root", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  const root = result.filePaths[0];
  await api("/api/local-bridge/agent/roots", { method: "POST", body: JSON.stringify({ path: root, label: path.basename(root) || root }) });
  config.roots = [...new Set([...config.roots, root])]; await saveConfig(); emit("bridge:roots", config.roots); return root;
});
ipcMain.handle("bridge:disconnect", async () => { config.token = ""; config.deviceId = ""; config.roots = []; await saveConfig(); clearInterval(pollTimer); emit("bridge:status", { connected: false }); });

async function createWindow() {
  await loadConfig();
  mainWindow = new BrowserWindow({ width: 980, height: 700, minWidth: 760, minHeight: 560, title: "Agent Studio Local Bridge", backgroundColor: "#0b1018", webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true } });
  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  if (config.token) startPolling();
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
