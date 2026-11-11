// Builds the agent-host package a business system's host installs with agent-host-install.sh:
// a pinned Node.js, the shared Local Bridge runtime and the service, for Linux x64 and ARM64.
// Publish everything in dist-agent-host/ to the downloads/local-bridge directory.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = path.join(root, 'packages/local-bridge');
const dist = path.join(source, 'dist-agent-host');
const staging = path.join(root, 'temp/local-bridge-cli-build'); // shares the Node download cache with build-cli
const nodeVersion = '22.23.2';
const hashes = { x64: 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307', arm64: 'fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8' };
const { VERSION } = createRequire(import.meta.url)(path.join(source, 'service/agent-host.cjs'));
const digest = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true }); await fs.mkdir(staging, { recursive: true });
const files = [];
for (const [arch, expected] of Object.entries(hashes)) {
  const basename = `node-v${nodeVersion}-linux-${arch}`;
  const archive = path.join(staging, basename + '.tar.xz');
  if (await digest(archive).catch(() => '') !== expected) execFileSync('curl', ['-fSL', '--retry', '2', `https://nodejs.org/dist/v${nodeVersion}/${basename}.tar.xz`, '-o', archive], { stdio: 'inherit' });
  if (await digest(archive) !== expected) throw new Error('Node archive checksum mismatch');
  execFileSync('tar', ['-xf', archive, '-C', staging, `${basename}/bin/node`, `${basename}/LICENSE`]);
  const bundle = path.join(staging, `agent-host-${arch}`);
  await fs.rm(bundle, { recursive: true, force: true });
  await fs.mkdir(path.join(bundle, 'bin'), { recursive: true });
  await fs.copyFile(path.join(staging, basename, 'bin/node'), path.join(bundle, 'bin/node'));
  await fs.copyFile(path.join(staging, basename, 'LICENSE'), path.join(bundle, 'NODE-LICENSE'));
  await fs.cp(path.join(source, 'runtime'), path.join(bundle, 'runtime'), { recursive: true });
  await fs.mkdir(path.join(bundle, 'service'), { recursive: true });
  for (const file of ['agent-host.cjs', 'handbook.cjs', 'sandbox.cjs', 'README-agent-host.md']) await fs.copyFile(path.join(source, 'service', file), path.join(bundle, 'service', file));
  await fs.copyFile(path.join(source, 'service/bailey-agent-host@.service'), path.join(bundle, 'bailey-agent-host@.service'));
  await fs.writeFile(path.join(bundle, 'VERSION'), VERSION + '\n');
  await fs.chmod(path.join(bundle, 'bin/node'), 0o755);
  const name = `bailey-agent-host-linux-${arch}.tar.gz`;
  execFileSync('tar', [...(process.platform === 'darwin' ? ['--no-xattrs'] : []), '-czf', path.join(dist, name), '-C', bundle, 'bin', 'runtime', 'service', 'bailey-agent-host@.service', 'VERSION', 'NODE-LICENSE'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  files.push({ name, sha256: await digest(path.join(dist, name)), bytes: (await fs.stat(path.join(dist, name))).size });
}
await fs.copyFile(path.join(source, 'service/agent-host-install.sh'), path.join(dist, 'agent-host-install.sh'));
await fs.writeFile(path.join(dist, 'agent-host-SHA256SUMS'), files.map(f => `${f.sha256}  ${f.name}`).join('\n') + '\n');
console.log(JSON.stringify({ version: VERSION, nodeVersion, files }, null, 2));
