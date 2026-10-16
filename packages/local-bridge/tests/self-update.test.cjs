const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { createCliUpdater, installedPackage, RESTART_EXIT_CODE } = require('../cli/self-update.cjs');

const launcherSource = path.resolve(__dirname, '../cli/bailey-connect');
const sha = buffer => createHash('sha256').update(buffer).digest('hex');

/** A package laid out like connect.sh installs it; its fake node prints `label` and exits with `code`. */
async function writePackage(dir, label, code = 0) {
  await fs.mkdir(path.join(dir, 'bin'), { recursive: true }); await fs.mkdir(path.join(dir, 'cli'), { recursive: true });
  await fs.writeFile(path.join(dir, 'bin/node'), `#!/bin/sh\n[ "$1" = --version ] && { echo v22; exit 0; }\necho "${label} $2 $3"\nexit ${code}\n`, { mode: 0o755 });
  await fs.copyFile(launcherSource, path.join(dir, 'bin/bailey-connect')); await fs.chmod(path.join(dir, 'bin/bailey-connect'), 0o755);
  await fs.writeFile(path.join(dir, 'cli/bailey-connect.cjs'), '');
}

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bailey-cli-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'share'); const oldHash = 'a'.repeat(64);
  await writePackage(path.join(home, oldHash), 'old');
  await fs.mkdir(path.join(root, 'bin'));
  const launcher = path.join(root, 'bin/bailey-connect');
  await fs.symlink(path.join(home, oldHash, 'bin/bailey-connect'), launcher);
  const source = path.join(root, 'new-package'); await writePackage(source, 'new');
  const tarball = path.join(root, 'new.tar.gz');
  execFileSync('tar', ['-czf', tarball, '-C', source, 'bin', 'cli'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const bytes = await fs.readFile(tarball);
  return { root, home, launcher, oldHash, bytes, newHash: sha(bytes), pkg: installedPackage(path.join(home, oldHash)) };
}

function fakeFetch(sums, bytes) {
  const calls = [];
  return { calls, impl: async url => { calls.push(url); return url.includes('cli-SHA256SUMS') ? new Response(sums) : new Response(bytes); } };
}

test('only connect.sh installs (hash-named directories) update themselves', () => {
  assert.equal(installedPackage(path.resolve(__dirname, '..')), null);
  assert.deepEqual(installedPackage('/home/u/.local/share/bailey-local-bridge/' + 'b'.repeat(64)).hash, 'b'.repeat(64));
});

test('the current package does nothing', async t => {
  const env = await setup(t);
  const fetch = fakeFetch(`${env.oldHash}  bailey-connect-linux-x64.tar.gz\n`, env.bytes);
  const updater = createCliUpdater({ pkg: env.pkg, downloadUrl: 'https://example.test/d', arch: 'x64', launcher: env.launcher, fetchImpl: fetch.impl });
  assert.equal(await updater.check(), 'latest');
  assert.equal(fetch.calls.length, 1);
});

test('a verified package is installed beside the running one and restarts when idle', async t => {
  const env = await setup(t);
  let idle = false; const restarts = [];
  const fetch = fakeFetch(`${'c'.repeat(64)}  bailey-connect-linux-arm64.tar.gz\n${env.newHash}  bailey-connect-linux-x64.tar.gz\n`, env.bytes);
  const updater = createCliUpdater({ pkg: env.pkg, downloadUrl: 'https://example.test/d', arch: 'x64', launcher: env.launcher, fetchImpl: fetch.impl, isIdle: () => idle, onReady: target => restarts.push(target) });
  assert.equal(await updater.check(), 'ready');
  const target = path.join(env.home, env.newHash);
  assert.equal(await fs.readlink(env.launcher), path.join(target, 'bin/bailey-connect'));
  assert.equal((await fs.readFile(path.join(env.home, 'current'), 'utf8')).trim(), path.join(target, 'bin/bailey-connect'));
  assert.ok(await fs.stat(path.join(env.home, env.oldHash, 'bin/node')), 'the running package stays');
  assert.deepEqual(restarts, []);
  idle = true;
  assert.equal(updater.idle(), 'restarting');
  assert.deepEqual(restarts, [target]);
});

test('a download that does not match its checksum installs nothing', async t => {
  const env = await setup(t);
  const fetch = fakeFetch(`${env.newHash}  bailey-connect-linux-x64.tar.gz\n`, Buffer.from('tampered'));
  const updater = createCliUpdater({ pkg: env.pkg, downloadUrl: 'https://example.test/d', arch: 'x64', launcher: env.launcher, fetchImpl: fetch.impl, onReady: () => assert.fail('must not restart') });
  assert.equal(await updater.check(), 'error');
  assert.deepEqual((await fs.readdir(env.home)).sort(), [env.oldHash]);
  assert.equal(await fs.readlink(env.launcher), path.join(env.home, env.oldHash, 'bin/bailey-connect'));
});

test('a launcher the user points elsewhere is left alone', async t => {
  const env = await setup(t);
  await fs.rm(env.launcher); await fs.symlink('/opt/custom/bailey-connect', env.launcher);
  const fetch = fakeFetch(`${env.newHash}  bailey-connect-linux-x64.tar.gz\n`, env.bytes);
  const updater = createCliUpdater({ pkg: env.pkg, downloadUrl: 'https://example.test/d', arch: 'x64', launcher: env.launcher, fetchImpl: fetch.impl });
  await updater.check();
  assert.equal(await fs.readlink(env.launcher), '/opt/custom/bailey-connect');
});

test('the launcher continues with the new package in the same terminal and arguments', async t => {
  const env = await setup(t);
  const oldDir = path.join(env.home, env.oldHash); const newDir = path.join(env.home, env.newHash);
  await writePackage(oldDir, 'old', RESTART_EXIT_CODE); await writePackage(newDir, 'new', 0);
  await fs.writeFile(path.join(env.home, 'current'), path.join(newDir, 'bin/bailey-connect') + '\n');
  const result = spawnSync('bash', [path.join(oldDir, 'bin/bailey-connect'), '--code', 'ABCDEF1234', '--server', 'https://x.test'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  // The used one-time pairing code is dropped; the new version reuses the saved connection.
  assert.equal(result.stdout, 'old --code ABCDEF1234\nnew --server https://x.test\n');
  // Without a different package to continue with, it stops instead of looping.
  await fs.writeFile(path.join(env.home, 'current'), path.join(oldDir, 'bin/bailey-connect') + '\n');
  assert.equal(spawnSync('bash', [path.join(oldDir, 'bin/bailey-connect')], { encoding: 'utf8' }).stdout, 'old  \n');
});
