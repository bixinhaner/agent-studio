'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');

/**
 * Self-update for the Linux command line. connect.sh installs each package at
 * <home>/<sha256 of its tarball>, so a package knows its own version by its directory name.
 * A newer package is installed next to the running one (never over it), `<home>/current`
 * names its launcher, and the process exits with RESTART_EXIT_CODE once idle; the launcher
 * then starts the new package in the same terminal with the same arguments.
 */
const RESTART_EXIT_CODE = 75;
const CHECK_INTERVAL = 6 * 3600000;
const HASH = /^[a-f0-9]{64}$/;
const run = (file, args) => new Promise((resolve, reject) => execFile(file, args, { timeout: 120000 }, error => error ? reject(error) : resolve()));
const exists = file => fs.access(file).then(() => true, () => false);

function installedPackage(packageDir = path.resolve(__dirname, '..')) {
  const hash = path.basename(packageDir);
  return HASH.test(hash) ? { home: path.dirname(packageDir), hash, dir: packageDir } : null;
}

async function replaceFile(target, write) {
  const temp = `${target}.${process.pid}.tmp`;
  await fs.rm(temp, { force: true });
  await write(temp);
  await fs.rename(temp, target);
}

function createCliUpdater({ pkg, downloadUrl, arch, launcher, fetchImpl = fetch, isIdle = () => true, onReady = () => {}, log = () => {} }) {
  const name = `bailey-connect-linux-${arch}.tar.gz`;
  let ready = null; let checking = null; let timers = [];

  async function install(hash) {
    const target = path.join(pkg.home, hash);
    if (await exists(path.join(target, 'bin/node'))) return target;
    const stage = await fs.mkdtemp(path.join(pkg.home, '.update.'));
    try {
      const file = path.join(stage, name);
      const response = await fetchImpl(`${downloadUrl}/${name}`, { signal: AbortSignal.timeout(30 * 60000) });
      if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}）`);
      const digest = createHash('sha256'); const out = fsSync.createWriteStream(file);
      try { for await (const chunk of response.body) { digest.update(chunk); if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve)); } }
      finally { await new Promise(resolve => out.end(resolve)); }
      if (digest.digest('hex') !== hash) throw new Error('新版本校验失败，已丢弃');
      const unpacked = path.join(stage, 'package');
      await fs.mkdir(unpacked);
      await run('tar', ['-xzf', file, '-C', unpacked, '--no-same-owner']);
      await run(path.join(unpacked, 'bin/node'), ['--version']);
      await fs.rename(unpacked, target).catch(async error => { if (!await exists(path.join(target, 'bin/node'))) throw error; });
      return target;
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }

  async function activate(target) {
    const next = path.join(target, 'bin/bailey-connect');
    await replaceFile(path.join(pkg.home, 'current'), temp => fs.writeFile(temp, next + '\n'));
    // Repoint ~/.local/bin/bailey-connect only when it is ours, so later manual runs use the new version too.
    const current = await fs.readlink(launcher).catch(() => null);
    if (current && path.dirname(path.dirname(path.dirname(path.resolve(path.dirname(launcher), current)))) === pkg.home) await replaceFile(launcher, temp => fs.symlink(next, temp));
    // Keep the running package and the new one; older packages are no longer referenced.
    for (const entry of await fs.readdir(pkg.home)) if (HASH.test(entry) && entry !== pkg.hash && entry !== path.basename(target)) await fs.rm(path.join(pkg.home, entry), { recursive: true, force: true });
  }

  async function check() {
    if (ready) return idle();
    if (checking) return checking;
    checking = (async () => {
      try {
        const response = await fetchImpl(`${downloadUrl}/cli-SHA256SUMS?t=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) return 'error';
        const line = (await response.text()).split('\n').find(item => item.trim().split(/\s+/)[1] === name);
        const hash = line?.trim().split(/\s+/)[0];
        if (!hash || !HASH.test(hash) || hash === pkg.hash) return 'latest';
        const target = await install(hash);
        await activate(target);
        ready = target;
        log('已下载新版本，空闲时会自动重启连接完成更新。');
        return idle();
      } catch (error) {
        log(`自动更新暂不可用：${error?.message || error}；稍后重试。`);
        return 'error';
      } finally { checking = null; }
    })();
    return checking;
  }

  function idle() {
    if (!ready || !isIdle()) return ready ? 'ready' : 'latest';
    stop(); onReady(ready);
    return 'restarting';
  }

  function start(delay = 30000) {
    const first = setTimeout(() => void check(), delay); first.unref?.();
    const periodic = setInterval(() => void check(), CHECK_INTERVAL); periodic.unref?.();
    const waiting = setInterval(() => { if (ready) idle(); }, 60000); waiting.unref?.();
    timers = [first, periodic, waiting];
  }
  function stop() { for (const timer of timers) { clearTimeout(timer); clearInterval(timer); } timers = []; }

  return { check, idle, start, stop, get ready() { return ready; } };
}

module.exports = { createCliUpdater, installedPackage, RESTART_EXIT_CODE };
