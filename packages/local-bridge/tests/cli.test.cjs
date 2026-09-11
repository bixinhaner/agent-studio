const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { parseArgs } = require('../cli/bailey-connect.cjs');
const cli = path.resolve(__dirname, '../cli/bailey-connect.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { const start = Date.now(); while (!check()) { if (Date.now() - start > 12000) throw new Error('Timed out waiting for CLI'); await pause(30); } }

test('arguments reject insecure remote origins and malformed codes', () => {
  assert.throws(() => parseArgs(['--server', 'http://example.com']));
  assert.throws(() => parseArgs(['--server', 'https://user:secret@example.com']));
  assert.throws(() => parseArgs(['--code', '$(echo bad)']));
  assert.equal(parseArgs(['--code', 'ABCDEF1234']).code, 'ABCDEF1234');
});

test('CLI pairs the current directory, executes locally, reuses credentials, rejects duplicate startup and stops on revocation', async () => {
  const tempRoot = path.resolve(__dirname, '../../../temp'); await fs.mkdir(tempRoot, { recursive: true });
  const temp = await fs.mkdtemp(path.join(tempRoot, 'cli-test-'));
  const cwd = path.join(temp, '目录 with spaces'); await fs.mkdir(cwd);
  const roots = [], results = []; let pairings = 0, completed = false, revoked = false, sent = false;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.setHeader('content-type', 'application/json');
    if (revoked) { res.statusCode = 401; return res.end('{}'); }
    if (req.url.endsWith('/pair')) { pairings++; assert.equal(body.code, 'ABCDEF1234'); return res.end(JSON.stringify({ token: 'test-device-token', device_id: 'device', connection_id: 'connection' })); }
    assert.equal(req.headers.authorization, 'Bearer test-device-token');
    if (req.url.endsWith('/roots')) { roots.push(body.path); return res.end(JSON.stringify({ root: { id: 'root', path: body.path, label: body.label } })); }
    if (req.url.endsWith('/complete')) { completed = true; assert.equal(body.root_id, 'root'); }
    if (req.url.endsWith('/poll') && !sent) { sent = true; return res.end(JSON.stringify({ command: { id: 'cli-local-exec', lease: 'lease', op: 'exec', rootId: 'root', threadId: 'task', args: { command: 'pwd; echo local-linux > result.txt', yield_ms: 1000 } } })); }
    if (req.url.endsWith('/result')) results.push(body.result);
    res.end(JSON.stringify({ command: null }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const children = [];
  function start(args = []) {
    const child = spawn(process.execPath, [cli, '--server', url, ...args], { cwd, env: { ...process.env, XDG_STATE_HOME: path.join(temp, 'state') } });
    child.output = ''; child.stdout.on('data', data => { child.output += data; }); child.stderr.on('data', data => { child.output += data; }); children.push(child); return child;
  }
  try {
    const first = start(['--code', 'ABCDEF1234']); await until(() => results.length === 1);
    assert.equal(completed, true); assert.equal(roots[0], await fs.realpath(cwd)); assert.equal(results[0].ok, true);
    assert.equal((await fs.readFile(path.join(cwd, 'result.txt'), 'utf8')).trim(), 'local-linux');
    assert.equal(results[0].output.trim(), await fs.realpath(cwd)); assert.ok(!first.output.includes('test-device-token'));
    const duplicate = start(); await until(() => duplicate.exitCode !== null); assert.equal(duplicate.exitCode, 1); assert.match(duplicate.output, /已有连接/);
    first.kill('SIGINT'); await until(() => first.exitCode !== null); assert.equal(first.exitCode, 0);
    const stateDir = path.join(temp, 'state/bailey-local-bridge', (await fs.readdir(path.join(temp, 'state/bailey-local-bridge')))[0]);
    assert.equal((await fs.stat(path.join(stateDir, 'connection.json'))).mode & 0o777, 0o600);
    const second = start(); await until(() => second.output.includes('已连接')); assert.equal(pairings, 1);
    revoked = true; await until(() => second.exitCode !== null); assert.equal(second.exitCode, 1); assert.match(second.output, /连接已失效/);
    assert.equal(roots.length, 2);
  } finally { for (const child of children) if (child.exitCode === null) child.kill('SIGTERM'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(temp, { recursive: true, force: true }); }
});
