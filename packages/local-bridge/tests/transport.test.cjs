const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createExecutor, shellInvocation, completeUtf8Length } = require('../runtime/executor.cjs');
const { runTransport } = require('../runtime/transport.cjs');
const work = path.resolve(__dirname, '../../../temp/local-bridge-tests', randomUUID());
after(() => fs.rm(work, { recursive: true, force: true }));
const httpError = (status, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });
const until = async (check, ms = 5000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
async function fixture() {
  const dir = path.join(work, randomUUID()); const root = path.join(dir, 'files'); await fs.mkdir(root, { recursive: true });
  const executor = createExecutor({ getRoots: () => [{ id: 'root', path: root }], journalDir: path.join(dir, 'receipts'), version: '9.9.9' });
  const call = (op, args) => executor.execute({ id: randomUUID(), rootId: 'root', threadId: 'task', op, args });
  return { dir, root, executor, call };
}

test('Windows commands are quoted for cmd /s /c and passed verbatim', () => {
  const command = 'python -c "print(\'中文\')" && dir "C:\\My Files"';
  assert.deepEqual(shellInvocation(command, 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }), { file: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true });
  assert.deepEqual(shellInvocation('ls', 'linux', { SHELL: '/bin/bash' }), { file: '/bin/bash', args: ['-lc', 'ls'], windowsVerbatimArguments: false });
});

test('running output never ends inside a UTF-8 character', () => {
  const zhong = Buffer.from('中'); // 3 bytes
  assert.equal(completeUtf8Length(Buffer.concat([Buffer.from('a'), zhong.subarray(0, 2)])), 1);
  assert.equal(completeUtf8Length(Buffer.concat([Buffer.from('a'), zhong])), 4);
  assert.equal(completeUtf8Length(Buffer.from([0xd6, 0xd0])), 2); // GBK pairs are not UTF-8 leads waiting for more
});

test('command output is returned as exact bytes, including legacy code pages', async () => {
  const f = await fixture();
  const r = await f.call('exec', { command: "printf '\\326\\320\\316\\304 ok\\n'" });
  assert.deepEqual(Buffer.from(r.output_base64, 'base64'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x20, 0x6f, 0x6b, 0x0a]));
  assert.equal(r.cursor, 8);
  assert.equal('output' in r, false);
});

test('ranged reads, conditional writes and raw AGENTS.md bytes', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.root, 'big.txt'), 'abcdefghij');
  const part = await f.call('read', { path: 'big.txt', encoding: 'base64', offset: 3, length: 4 });
  assert.equal(Buffer.from(part.content, 'base64').toString(), 'defg');
  assert.deepEqual([part.size, part.offset, part.length, part.eof], [10, 3, 4, false]);
  const sha = require('node:crypto').createHash('sha256').update('abcdefghij').digest('hex');
  assert.equal((await f.call('write', { path: 'big.txt', content: Buffer.from('new').toString('base64'), encoding: 'base64', expected_sha256: '0'.repeat(64) })).error, 'FILE_CHANGED_SINCE_READ');
  assert.equal(await fs.readFile(path.join(f.root, 'big.txt'), 'utf8'), 'abcdefghij');
  assert.equal((await f.call('write', { path: 'big.txt', content: Buffer.from('new').toString('base64'), encoding: 'base64', expected_sha256: sha })).ok, true);
  await fs.writeFile(path.join(f.root, 'AGENTS.md'), Buffer.from([0xff, 0xfe, 0x41, 0x00]));
  const info = await f.call('workspace_info', {});
  assert.equal(info.instructions_base64, Buffer.from([0xff, 0xfe, 0x41, 0x00]).toString('base64'));
  assert.equal(info.client_version, '9.9.9');
});

test('a result the server keeps failing does not stop heartbeats or new work', async () => {
  const signal = new AbortController(); let heartbeats = 0; const executed = []; const delivered = [];
  const commands = [{ id: 'bad', lease: 'l1', threadId: 't1', op: 'read' }, { id: 'good', lease: 'l2', threadId: 't2', op: 'read' }];
  const api = async (endpoint, init) => {
    if (endpoint.endsWith('/heartbeat')) { heartbeats++; return {}; }
    if (endpoint.endsWith('/poll')) return { command: commands.shift() || null };
    const body = JSON.parse(init.body);
    if (body.id === 'bad') throw httpError(503);
    delivered.push(body.id); return { acknowledged: true };
  };
  const statuses = [];
  const done = runTransport({ api, executor: { execute: async c => { executed.push(c.id); return { ok: true }; } }, signal: signal.signal, heartbeatMs: 30, idleMs: 20, onStatus: s => statuses.push(s) });
  await until(() => delivered.includes('good') && heartbeats >= 3);
  signal.abort(); await done;
  assert.deepEqual(executed.sort(), ['bad', 'good']);
  assert.ok(statuses.some(s => s.connected && s.pendingDeliveries === 1 && /重试/.test(s.deliveryError)), 'shows a pending delivery while staying connected');
});

test('a result the server rejects is replaced by an explicit delivery failure', async () => {
  const signal = new AbortController(); const bodies = []; let sent = false;
  const api = async (endpoint, init) => {
    if (endpoint.endsWith('/heartbeat')) return {};
    if (endpoint.endsWith('/poll')) { if (sent) return { command: null }; sent = true; return { command: { id: 'x', lease: 'l', threadId: 't', op: 'read' } }; }
    const body = JSON.parse(init.body); bodies.push(body.result);
    if (bodies.length === 1) throw httpError(400, 'Invalid result');
    signal.abort(); return {};
  };
  await runTransport({ api, executor: { execute: async () => ({ ok: true, content: 'x' }) }, signal: signal.signal, idleMs: 20 });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].error, 'RESULT_DELIVERY_FAILED');
  assert.match(bodies[1].reason, /HTTP 400/);
});

test('after a restart, an undelivered result is delivered from the outbox without running again', async () => {
  const outboxDir = path.join(work, randomUUID()); let executions = 0; const executor = { execute: async () => { executions++; return { ok: true, n: 1 }; } };
  let first = new AbortController(); let served = false;
  await runTransport({ outboxDir, executor, signal: first.signal, idleMs: 20, api: async (endpoint) => {
    if (endpoint.endsWith('/heartbeat')) return {};
    if (endpoint.endsWith('/poll')) { if (served) return { command: null }; served = true; return { command: { id: 'r1', lease: 'old', threadId: 't', op: 'exec' } }; }
    setTimeout(() => first.abort(), 10); throw new Error('fetch failed');
  } });
  assert.equal(executions, 1);
  const second = new AbortController(); const delivered = [];
  // The relay re-leases the same request after the client restarts.
  let releases = 1;
  await runTransport({ outboxDir, executor, signal: second.signal, idleMs: 20, api: async (endpoint, init) => {
    if (endpoint.endsWith('/heartbeat')) return {};
    if (endpoint.endsWith('/poll')) return { command: releases-- > 0 ? { id: 'r1', lease: 'new', threadId: 't', op: 'exec' } : null };
    delivered.push(JSON.parse(init.body)); second.abort(); return {};
  } });
  assert.equal(executions, 1);
  assert.equal(delivered[0].id, 'r1');
  assert.deepEqual(delivered[0].result, { ok: true, n: 1 });
  assert.deepEqual(await fs.readdir(outboxDir), []);
});

test('steps of one task run in order while another task proceeds', async () => {
  const signal = new AbortController(); const log = [];
  const queue = [{ id: 'a1', threadId: 'A', op: 'exec' }, { id: 'a2', threadId: 'A', op: 'read' }, { id: 'b1', threadId: 'B', op: 'read' }];
  let delivered = 0;
  const api = async (endpoint) => { if (endpoint.endsWith('/heartbeat')) return {}; if (endpoint.endsWith('/poll')) return { command: queue.shift() || null }; if (++delivered === 3) signal.abort(); return {}; };
  const executor = { execute: async c => { log.push(`start ${c.id}`); await new Promise(r => setTimeout(r, c.id === 'a1' ? 150 : 10)); log.push(`end ${c.id}`); return { ok: true }; } };
  await runTransport({ api, executor, signal: signal.signal, idleMs: 10 });
  assert.ok(log.indexOf('end b1') < log.indexOf('end a1'), 'task B is not blocked by task A');
  assert.ok(log.indexOf('end a1') < log.indexOf('start a2'), 'task A steps stay sequential');
});
