const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createUpdater, compareVersions, pickAsset } = require('../electron/updater.cjs');

const installer = Buffer.from('fake installer bytes');
const sha = createHash('sha256').update(installer).digest('hex');
const manifest = (version, overrides = {}) => ({ version, files: [
  { name: 'Agent-Studio-Local-Bridge-latest-Windows-x64.exe', bytes: installer.length, sha256: sha },
  { name: 'Agent-Studio-Local-Bridge-latest-mac-arm64.zip', bytes: installer.length, sha256: sha },
  { name: 'Agent-Studio-Local-Bridge-latest-mac-arm64.dmg', bytes: installer.length, sha256: sha },
  { name: 'Agent-Studio-Local-Bridge-latest-Linux-amd64.deb', bytes: installer.length, sha256: sha },
  ...(overrides.files || [])
] });

function fakeFetch(body, payload = installer) {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    if (url.includes('manifest.json')) return new Response(JSON.stringify(body));
    return new Response(payload);
  };
  return { impl, calls };
}

async function updater(t, options) {
  const updatesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-updates-'));
  t.after(() => fs.rm(updatesDir, { recursive: true, force: true }));
  const spawned = []; let quits = 0;
  const instance = createUpdater({
    currentVersion: '0.3.0', baseUrl: 'https://example.test/downloads/local-bridge/', updatesDir, platform: 'win32', arch: 'x64',
    spawn: (file, args) => { spawned.push({ file, args }); return { unref() {} }; },
    quit: () => { quits++; },
    ...options
  });
  return { instance, updatesDir, spawned, quits: () => quits };
}

test('compareVersions orders semantic versions numerically', () => {
  assert.equal(compareVersions('0.3.0', '0.2.3'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.3', '0.3.0'), 0);
  assert.equal(compareVersions('0.2.3', '0.3.0'), -1);
});

test('pickAsset chooses the installer each platform can apply by itself', () => {
  const m = manifest('0.4.0', { files: [{ name: 'Agent-Studio-Local-Bridge-latest-Linux-x86_64.AppImage' }] });
  assert.equal(pickAsset(m, { platform: 'win32', arch: 'x64' }).kind, 'nsis');
  const mac = pickAsset(m, { platform: 'darwin', arch: 'arm64' });
  assert.match(mac.file.name, /mac-arm64\.zip$/); assert.match(mac.manual.name, /mac-arm64\.dmg$/);
  assert.equal(pickAsset(m, { platform: 'linux', arch: 'x64', appImage: '/opt/a.AppImage' }).kind, 'appimage');
  const deb = pickAsset(m, { platform: 'linux', arch: 'x64' });
  assert.equal(deb.automatic, false); assert.match(deb.manual.name, /amd64\.deb$/);
});

test('an up-to-date client downloads nothing', async t => {
  const fetch = fakeFetch(manifest('0.3.0'));
  const { instance, spawned } = await updater(t, { fetchImpl: fetch.impl });
  const state = await instance.check();
  assert.equal(state.status, 'latest');
  assert.equal(fetch.calls.length, 1);
  assert.equal(spawned.length, 0);
});

test('a verified Windows update installs silently when the computer is idle', async t => {
  const fetch = fakeFetch(manifest('0.4.0'));
  const { instance, updatesDir, spawned, quits } = await updater(t, { fetchImpl: fetch.impl, isIdle: () => true });
  await instance.check();
  assert.equal(instance.state.status, 'installing');
  assert.deepEqual(spawned, [{ file: path.join(updatesDir, 'Agent-Studio-Local-Bridge-latest-Windows-x64.exe'), args: ['--updated', '/S', '--force-run'] }]);
  assert.equal(quits(), 1);
});

test('a busy computer keeps the update ready until it becomes idle', async t => {
  let idle = false;
  const fetch = fakeFetch(manifest('0.4.0'));
  const { instance, spawned, quits } = await updater(t, { fetchImpl: fetch.impl, isIdle: () => idle });
  await instance.check();
  assert.equal(instance.state.status, 'ready');
  assert.equal(spawned.length, 0);
  idle = true; instance.idle();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spawned.length, 1); assert.equal(quits(), 1);
});

test('a download that does not match the manifest is discarded and nothing is installed', async t => {
  const fetch = fakeFetch(manifest('0.4.0'), Buffer.from('tampered installer!!'));
  const { instance, updatesDir, spawned, quits } = await updater(t, { fetchImpl: fetch.impl });
  const state = await instance.check();
  assert.equal(state.status, 'error');
  assert.match(state.error, /校验失败/);
  assert.deepEqual(await fs.readdir(updatesDir), []);
  assert.equal(spawned.length, 0); assert.equal(quits(), 0);
});

test('deb installs are pointed at a manual download instead of updating themselves', async t => {
  const fetch = fakeFetch(manifest('0.4.0'));
  const { instance, spawned } = await updater(t, { fetchImpl: fetch.impl, platform: 'linux', appImage: undefined });
  const state = await instance.check();
  assert.equal(state.status, 'manual');
  assert.equal(state.downloadUrl, 'https://example.test/downloads/local-bridge/Agent-Studio-Local-Bridge-latest-Linux-amd64.deb');
  assert.equal(fetch.calls.length, 1); assert.equal(spawned.length, 0);
});
