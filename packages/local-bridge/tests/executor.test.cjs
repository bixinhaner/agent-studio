const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createExecutor } = require('../runtime/executor.cjs');
const { runTransport } = require('../runtime/transport.cjs');
const work = path.resolve(__dirname, '../../../temp/local-bridge-tests');
let serial = 0;
async function fixture() {
  const dir = path.join(work, String(++serial)); await fs.mkdir(dir, { recursive: true });
  const root = path.join(dir, 'files'); await fs.mkdir(root);
  const journalDir = path.join(dir, 'receipts');
  const executor = createExecutor({ getRoots: () => [{ id: 'root', path: root }], journalDir });
  const call = (op, args, other = {}) => executor.execute({ id: randomUUID(), rootId: 'root', threadId: 'task', op, args, ...other });
  return { dir, root, journalDir, executor, call };
}
after(() => fs.rm(work, { recursive: true, force: true }));
test('local roots, creation, exact editing, rename and delete', async () => {
  const f = await fixture();
  assert.equal((await f.call('write', { path: 'new.txt', content: 'one\ntwo' })).ok, true);
  assert.equal((await f.call('edit', { path: 'new.txt', old_text: 'two', new_text: '$& three' })).ok, true);
  assert.equal((await f.call('read', { path: 'new.txt' })).content, 'one\n$& three');
  assert.equal((await f.call('move', { path: 'new.txt', destination: 'renamed.txt' })).ok, true);
  assert.equal((await f.call('delete', { path: 'renamed.txt' })).ok, true);
  assert.match((await f.call('read', { path: '../secret' })).error, /OUTSIDE/);
  assert.match((await f.call('read', { path: '.' }, { rootId: 'cloud-invented' })).error, /NOT_SELECTED/);
});
test('file tools follow local selection and reject symlink escapes; overwrite detaches hardlinks', async () => {
  const f = await fixture(); const outside = path.join(f.dir, 'outside'); await fs.writeFile(outside, 'untouched');
  await fs.symlink(outside, path.join(f.root, 'link'));
  assert.equal((await f.call('write', { path: 'link', content: 'bad' })).ok, false);
  await fs.link(outside, path.join(f.root, 'hardlink'));
  assert.equal((await f.call('write', { path: 'hardlink', content: 'new' })).ok, true);
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
});
test('same command concurrent and after restart never repeats a side effect', async () => {
  const f = await fixture(); const request = { id: randomUUID(), rootId: 'root', threadId: 'task', op: 'exec', args: { command: 'printf x >> count.txt' } };
  await Promise.all([f.executor.execute(request), f.executor.execute(request)]);
  const restarted = createExecutor({ getRoots: () => [{ id: 'root', path: f.root }], journalDir: f.journalDir });
  await restarted.execute(request);
  assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), 'x');
});
test('unfinished receipt after crash reports unknown outcome instead of re-running', async () => {
  const f = await fixture(); const id = randomUUID(); await fs.mkdir(f.journalDir); await fs.writeFile(path.join(f.journalDir, id + '.json'), '{"started":1}');
  const r = await f.call('exec', { command: 'echo must-not-run' }, { id }); assert.match(r.error, /UNKNOWN_AFTER_RESTART/);
});
test('trusted Shell can access outside cwd, output streams and cancellation kills the process group', async () => {
  const f = await fixture(); await fs.writeFile(path.join(f.dir, 'outside'), 'available');
  assert.match((await f.call('exec', { command: 'cat ../outside' })).output, /available/);
  const p = await f.call('exec', { command: 'printf ready; sleep 30; echo wrong > late.txt', yield_ms: 100 });
  assert.equal(p.running, true); assert.match(p.output, /ready/);
  assert.equal((await f.call('process', { process_id: p.process_id }, { threadId: 'other' })).ok, false);
  await f.call('cancel_task', {});
  const end = await f.call('process', { process_id: p.process_id, wait_ms: 2000, cursor: p.cursor });
  assert.equal(end.running, false); assert.equal(await fs.stat(path.join(f.root, 'late.txt')).then(() => true, () => false), false);
});
test('lost result acknowledgement retries delivery without executing again', async () => {
  const signal = new AbortController(); let calls = 0, attempts = 0;
  const api = async endpoint => { if (endpoint.endsWith('/poll')) return { command: { id: 'request', lease: 'lease' } }; attempts++; if (attempts === 1) throw new Error('network'); signal.abort(); return {}; };
  await runTransport({ api, executor: { execute: async () => { calls++; return { ok: true }; } }, signal: signal.signal });
  assert.equal(calls, 1); assert.equal(attempts, 2);
});
test('rename/delete operate on the symlink itself, not its target', async () => {
  const f = await fixture(); const outside = path.join(f.dir, 'kept'); await fs.writeFile(outside, 'keep');
  await fs.symlink(outside, path.join(f.root, 'link'));
  assert.equal((await f.call('move', { path: 'link', destination: 'renamed-link' })).ok, true);
  assert.equal((await f.call('delete', { path: 'renamed-link' })).ok, true);
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
});
test('pausing during a poll never starts the late-arriving command', async () => {
  const controller = new AbortController(); let executions = 0;
  await runTransport({signal:controller.signal, api:async()=>{controller.abort();return {command:{id:'late'}};}, executor:{execute:async()=>{executions++;return {ok:true};}}});
  assert.equal(executions,0);
});
