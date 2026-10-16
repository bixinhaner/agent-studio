const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn: nodeSpawn, execFile } = require('node:child_process');

/**
 * Self-update from the published manifest.json (version + SHA256 of every installer).
 * Electron's Squirrel updater needs a Developer ID signature on macOS, which these builds do
 * not have, so updates are installed directly: Windows runs the NSIS installer silently,
 * macOS swaps the app bundle, Linux AppImage swaps the file. Every download is verified
 * against the manifest before anything is replaced; a failure leaves the current app intact.
 */
const CHECK_INTERVAL = 6 * 3600000;

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return Math.sign(d); }
  return 0;
}

/** The manifest file this installation can update itself with, and whether that is automatic. */
function pickAsset(manifest, { platform, arch, appImage }) {
  const files = manifest?.files || [];
  const find = suffix => files.find(file => file.name.endsWith(suffix));
  if (platform === 'win32') return { file: find('Windows-x64.exe'), automatic: true, kind: 'nsis' };
  if (platform === 'darwin') return { file: find(`mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`), manual: find(`mac-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg`), automatic: true, kind: 'mac-zip' };
  if (platform === 'linux' && appImage) return { file: find('x86_64.AppImage'), automatic: true, kind: 'appimage' };
  if (platform === 'linux') return { file: null, manual: find('amd64.deb'), automatic: false, kind: 'deb' };
  return { file: null, automatic: false };
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of fsSync.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function createUpdater({ currentVersion, baseUrl, updatesDir, platform = process.platform, arch = process.arch, appImage = process.env.APPIMAGE, execPath = process.execPath, pid = process.pid, fetchImpl = fetch, spawn = nodeSpawn, quit, isIdle = () => true, onState = () => {}, openExternal = async () => {} }) {
  let state = { status: 'idle', currentVersion, latestVersion: null, progress: 0, error: '', automatic: true, downloadUrl: '' };
  let checking = null; let timer = null; let downloaded = null;
  const set = patch => { state = { ...state, ...patch }; onState({ ...state }); };
  const url = name => `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`;

  async function download(file) {
    await fs.mkdir(updatesDir, { recursive: true });
    const target = path.join(updatesDir, file.name);
    if (await sha256File(target).catch(() => '') === file.sha256) return target;
    // Keep only one installer around; older downloads and staging folders are no longer needed.
    for (const name of await fs.readdir(updatesDir)) await fs.rm(path.join(updatesDir, name), { recursive: true, force: true });
    const partial = target + '.part';
    const response = await fetchImpl(url(file.name), { signal: AbortSignal.timeout(30 * 60000) });
    if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}）`);
    const hash = createHash('sha256'); let received = 0; let lastReport = 0;
    const out = fsSync.createWriteStream(partial);
    try {
      for await (const chunk of response.body) {
        hash.update(chunk); received += chunk.length;
        if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
        if (Date.now() - lastReport > 500) { lastReport = Date.now(); set({ progress: Math.min(99, Math.floor(received / file.bytes * 100)) }); }
      }
    } finally { await new Promise(resolve => out.end(resolve)); }
    if (received !== file.bytes || hash.digest('hex') !== file.sha256) { await fs.rm(partial, { force: true }); throw new Error('安装包校验失败，已丢弃，将稍后重试。'); }
    await fs.rename(partial, target);
    return target;
  }

  async function check({ manual = false } = {}) {
    if (checking) return checking;
    if (['downloading', 'installing'].includes(state.status)) return state;
    checking = (async () => {
      if (state.status !== 'ready') set({ status: 'checking', error: '' });
      try {
        const response = await fetchImpl(url('manifest.json') + `?t=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`无法检查更新（${response.status}）`);
        const manifest = await response.json();
        if (compareVersions(manifest.version, currentVersion) <= 0) { set({ status: 'latest', latestVersion: manifest.version, progress: 0 }); return state; }
        const asset = pickAsset(manifest, { platform, arch, appImage });
        const manualUrl = asset.manual ? url(asset.manual.name) : '';
        if (!asset.automatic || !asset.file) { set({ status: 'manual', latestVersion: manifest.version, automatic: false, downloadUrl: manualUrl }); return state; }
        if (downloaded?.version === manifest.version) { set({ status: 'ready', latestVersion: manifest.version }); return state; }
        set({ status: 'downloading', latestVersion: manifest.version, progress: 0, downloadUrl: manualUrl });
        downloaded = { version: manifest.version, file: await download(asset.file), kind: asset.kind };
        set({ status: 'ready', progress: 100 });
        // Install unattended only when the computer is not working on a task.
        if (!manual && isIdle()) await install({ unattended: true });
        return state;
      } catch (error) {
        set({ status: 'error', error: error?.message || String(error) });
        return state;
      } finally { checking = null; }
    })();
    return checking;
  }

  async function install({ unattended = false } = {}) {
    if (!downloaded) return state;
    if (unattended && !isIdle()) return state;
    set({ status: 'installing', error: '' });
    try {
      if (downloaded.kind === 'nsis') {
        // electron-builder's one-click installer: silent per-user update, then start the app again.
        spawn(downloaded.file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      } else if (downloaded.kind === 'mac-zip') {
        await installMacBundle(downloaded.file);
      } else if (downloaded.kind === 'appimage') {
        const next = `${appImage}.new`;
        await fs.copyFile(downloaded.file, next); await fs.chmod(next, 0o755); await fs.rename(next, appImage);
        spawn(appImage, [], { detached: true, stdio: 'ignore' }).unref();
      }
      quit();
    } catch (error) {
      set({ status: 'manual', automatic: false, error: `自动更新失败：${error?.message || error}。请下载新版本手动安装。` });
    }
    return state;
  }

  async function installMacBundle(zip) {
    const bundle = path.resolve(execPath, '../../..');
    if (!bundle.endsWith('.app')) throw new Error('当前不是安装后的应用');
    await fs.access(path.dirname(bundle), fsSync.constants.W_OK);
    const staging = path.join(updatesDir, `staging-${Date.now()}`);
    await fs.mkdir(staging, { recursive: true });
    await new Promise((resolve, reject) => execFile('/usr/bin/ditto', ['-x', '-k', zip, staging], error => error ? reject(error) : resolve()));
    const app = (await fs.readdir(staging)).find(name => name.endsWith('.app'));
    if (!app) throw new Error('安装包内容不完整');
    const script = path.join(updatesDir, 'install-update.sh');
    // Waits for this app to exit, swaps the bundle (restoring the old one on failure), relaunches.
    await fs.writeFile(script, `#!/bin/sh
while kill -0 "$1" 2>/dev/null; do sleep 0.3; done
rm -rf "$2.previous"
if mv "$2" "$2.previous" && /usr/bin/ditto "$3" "$2"; then rm -rf "$2.previous"; else rm -rf "$2"; mv "$2.previous" "$2"; fi
/usr/bin/xattr -dr com.apple.quarantine "$2" 2>/dev/null
rm -rf "$4"
/usr/bin/open "$2"
`, { mode: 0o755 });
    spawn('/bin/sh', [script, String(pid), bundle, path.join(staging, app), staging], { detached: true, stdio: 'ignore' }).unref();
  }

  return {
    get state() { return { ...state }; },
    check,
    install,
    openDownload: () => state.downloadUrl && openExternal(state.downloadUrl),
    start(delay = 15000) { setTimeout(() => void check(), delay).unref?.(); timer = setInterval(() => void check(), CHECK_INTERVAL); timer.unref?.(); },
    /** Retry an unattended install once the computer becomes idle. */
    idle() { if (state.status === 'ready') void install({ unattended: true }); },
    stop() { if (timer) clearInterval(timer); }
  };
}

module.exports = { createUpdater, compareVersions, pickAsset };
