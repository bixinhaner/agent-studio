import express from 'express';
import request from 'supertest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bindingOut, bridgeHash, clientVersionOutdated, recoverLocalRequest, runLocalTool } from './local-bridge-service.js';
import { createLocalBridgeRouter, localBridgeBodyErrorHandler } from './local-bridge-router.js';
import { summarizeLocalOperation } from './admin/conversation-transcript-local.js';
import {
  LOSSY_OUTPUT_NOTE,
  RESULT_DELIVERY_FAILED,
  decodeCommandOutput,
  decodeLocalFile,
  decodeStoredJson,
  encodeStoredJson,
  prepareLocalCommand,
  presentLocalResult
} from './local-bridge-result.js';

const require = createRequire(import.meta.url);
const { createExecutor } = require('../../packages/local-bridge/runtime/executor.cjs');
const { runTransport } = require('../../packages/local-bridge/runtime/transport.cjs');

const UNSAFE = /\\u0000|\\ud[89ab]/i;

describe('reversible storage codec', () => {
  it('stores NUL, lone surrogates and the wrapper key itself losslessly', () => {
    for (const value of [{ ok: true, content: 'a\u0000b', lone: 'x\uD800y', ['k\u0000']: 1 }, { __agentStudioEncoded: 'json-base64', value: 'x' }]) {
      const stored = encodeStoredJson(value);
      expect(stored).not.toEqual(value);
      expect(JSON.stringify(stored)).not.toMatch(UNSAFE);
      expect(decodeStoredJson(stored)).toEqual(value);
    }
  });

  it('leaves values jsonb accepts untouched', () => {
    const clean = { ok: true, output: '中文 ✓ 😀', exit_code: 0, entries: [{ name: 'a' }] };
    expect(encodeStoredJson(clean)).toBe(clean);
    expect(decodeStoredJson(clean)).toBe(clean);
  });
});

describe('decodeLocalFile (acceptance 1: accurate text or an explicit explanation)', () => {
  const source = 'print("版本 v1")\n';
  it.each([
    ['UTF-8', Buffer.from(source, 'utf8'), 'utf-8', false],
    ['UTF-8 with BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source)]), 'utf-8', true],
    ['UTF-16LE with BOM', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')]), 'utf-16le', true],
    ['UTF-16LE without BOM', Buffer.from(source, 'utf16le'), 'utf-16le', false],
    ['UTF-16BE with BOM', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(source, 'utf16le').swap16()]), 'utf-16be', true]
  ])('%s', (_name, bytes, encoding, bom) => {
    expect(decodeLocalFile(bytes)).toMatchObject({ binary: false, content: source, encoding, bom });
  });

  it('decodes GBK/GB18030 Chinese source', () => {
    const gbk = Buffer.from([0x23, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0xd7, 0xa2, 0xca, 0xcd, 0x0a]); // "# 中文注释\n"
    expect(decodeLocalFile(gbk)).toMatchObject({ binary: false, content: '# 中文注释\n', encoding: 'gb18030' });
  });

  it('keeps NUL characters in UTF-8 text exactly and says so', () => {
    const result = decodeLocalFile(Buffer.from('a = 1\u0000\nb = 2\n'));
    expect(result).toMatchObject({ binary: false, content: 'a = 1\u0000\nb = 2\n', encoding: 'utf-8' });
    expect(!result.binary && result.note).toMatch(/1 NUL character/);
  });

  it('reports binary content instead of showing distorted text', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0xff, 0x00, 0x13, 0x88]);
    expect(decodeLocalFile(png)).toMatchObject({ binary: true, size: png.length, message: expect.stringContaining('base64') });
    expect(decodeLocalFile(Buffer.alloc(64))).toMatchObject({ binary: true });
  });

  it('decodes an empty file as empty UTF-8 text', () => {
    expect(decodeLocalFile(Buffer.alloc(0))).toMatchObject({ binary: false, content: '', encoding: 'utf-8' });
  });
});

describe('command output from byte-level clients', () => {
  it('decodes mixed UTF-8 and GBK lines individually and says so', () => {
    const bytes = Buffer.concat([Buffer.from('git: 中文提交\n'), Buffer.from([0xd5, 0xd2, 0xb2, 0xbb, 0xb5, 0xbd, 0xce, 0xc4, 0xbc, 0xfe, 0x0d, 0x0a])]);
    expect(decodeCommandOutput(bytes)).toEqual({ text: 'git: 中文提交\n找不到文件\r\n', note: expect.stringContaining('GBK') });
  });

  it('decodes whole UTF-16 output and leaves plain UTF-8 untouched', () => {
    expect(decodeCommandOutput(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Name\r\n', 'utf16le')]))).toMatchObject({ text: 'Name\r\n' });
    expect(decodeCommandOutput(Buffer.from('ok ✓\n'))).toEqual({ text: 'ok ✓\n' });
  });

  it('presents exec, process and workspace_info results as text', () => {
    const exec = presentLocalResult('exec', {}, { ok: true, output_base64: Buffer.from([0xd6, 0xd0, 0xce, 0xc4]).toString('base64'), cursor: 4 });
    expect(exec).toEqual({ ok: true, output: '中文', cursor: 4, output_note: expect.stringContaining('GBK') });
    const info = presentLocalResult('workspace_info', {}, { ok: true, directory: 'D', instructions_base64: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('规则', 'utf16le')]).toString('base64') });
    expect(info).toEqual({ ok: true, directory: 'D', instructions: '规则', instructions_encoding: 'utf-16le' });
  });
});

describe('command preparation', () => {
  it('makes Windows commands print UTF-8 but audits the command as the agent wrote it', () => {
    const args = { command: 'python get_omc_version.py && dir', env: { PYTHONIOENCODING: 'gbk' } };
    const prepared = prepareLocalCommand('exec', args, 'win32');
    expect(prepared.args.command).toBe('chcp 65001>nul & python get_omc_version.py && dir');
    expect(prepared.args.env).toEqual({ PYTHONIOENCODING: 'gbk' });
    expect(prepared.auditArgs).toBe(args);
    expect(prepareLocalCommand('exec', { command: 'ls' }, 'darwin').args).toEqual({ command: 'ls' });
  });

  it('flags output that was not valid UTF-8 instead of passing it off as exact', () => {
    expect(presentLocalResult('exec', {}, { ok: true, output: '�汾' })).toMatchObject({ output_note: LOSSY_OUTPUT_NOTE });
    expect(presentLocalResult('exec', {}, { ok: true, output: 'ok' })).not.toHaveProperty('output_note');
  });
});

/** Just enough of Prisma for the local bridge tables, with a hook to inject storage failures. */
function fakeDb() {
  const matches = (row: any, where: any = {}): boolean => Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === 'OR') return cond.some((c: any) => matches(row, c));
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('gt' in cond) return value != null && new Date(value).getTime() > new Date(cond.gt).getTime();
      if ('lt' in cond) return value != null && new Date(value).getTime() < new Date(cond.lt).getTime();
      if ('in' in cond) return cond.in.includes(value);
    }
    return value === cond;
  });
  const table = (rows: any[]) => ({
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter(r => matches(r, where)).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null,
    findUnique: async ({ where }: any) => rows.find(r => matches(r, where)) ?? null,
    update: async ({ where, data }: any) => Object.assign(rows.find(r => matches(r, where)), data),
    updateMany: async ({ where, data }: any) => { const hit = rows.filter(r => matches(r, where)); hit.forEach(r => Object.assign(r, data)); return { count: hit.length }; },
    upsert: async ({ where, create }: any) => rows.find(r => matches(r, where)) ?? (rows.push({ status: 'pending', createdAt: new Date(), lease: null, leaseUntil: null, result: null, ...create }), rows[rows.length - 1]),
    deleteMany: async () => ({ count: 0 })
  });
  const device = { id: 'device-1', status: 'active', platform: process.platform, tokenHash: bridgeHash('device-token'), lastSeenAt: new Date(), clientVersion: '0.3.0', roots: [] };
  const db: any = {
    localBridgeDevice: table([device]),
    localBridgeCommand: table([]),
    localBridgeOperationLog: table([]),
    localBridgeBinding: { findUnique: async () => ({ id: 'binding-1' }) },
    localBridgeConnection: { deleteMany: async () => ({ count: 0 }) },
    // Called before each command completion; throw to simulate the database rejecting it.
    failCompletion: undefined as undefined | ((id: string, data: any) => void)
  };
  const updateMany = db.localBridgeCommand.updateMany;
  db.localBridgeCommand.updateMany = async (args: any) => {
    if (args.data?.status === 'completed') db.failCompletion?.(args.where.id, args.data);
    return updateMany(args);
  };
  return { db, device };
}

describe('local computer round trip with the real desktop client', { timeout: 20000 }, () => {
  let dir: string; let journal: string; let stop: AbortController; let transport: Promise<void>;
  let db: any; let device: any; let binding: any; let executions = 0;

  async function startClient() {
    const app = express();
    app.use('/api/local-bridge', express.json({ limit: '16mb' }), localBridgeBodyErrorHandler(db));
    app.use('/api/local-bridge', createLocalBridgeRouter(db));
    const executor = createExecutor({ getRoots: async () => [{ id: 'root-1', path: dir }], journalDir: journal });
    const counted = { execute: (command: any) => { executions++; return executor.execute(command); } };
    stop = new AbortController();
    const api = async (url: string, init: any) => {
      const res = await request(app).post(url).auth('device-token', { type: 'bearer' }).set('content-type', 'application/json').set('x-local-bridge-version', '0.3.0').send(init.body);
      if (res.status >= 300) throw new Error(`HTTP ${res.status}`);
      return res.body;
    };
    transport = runTransport({ api, executor: counted, signal: stop.signal });
  }
  const call = (op: string, args: any, id = crypto.randomUUID()) => runLocalTool(db, binding, op, args, id);

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'local-bridge-root-'));
    journal = await mkdtemp(path.join(os.tmpdir(), 'local-bridge-journal-'));
    ({ db, device } = fakeDb());
    binding = { id: 'binding-1', threadId: 'thread-1', rootId: 'root-1', root: { id: 'root-1', path: dir, deviceId: device.id, device } };
    executions = 0;
    await startClient();
  });
  afterEach(async () => {
    stop.abort(); await transport;
    await rm(dir, { recursive: true, force: true }); await rm(journal, { recursive: true, force: true });
  });

  it('reads UTF-8, UTF-16, NUL-containing, GBK and binary files exactly or explains them (acceptance 1)', async () => {
    const text = 'def version():\n    return "版本 1.2"  # 注释\n';
    await writeFile(path.join(dir, 'utf8.py'), text);
    await writeFile(path.join(dir, 'utf16.py'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
    await writeFile(path.join(dir, 'nul.py'), 'x = 1\u0000\n');
    await writeFile(path.join(dir, 'gbk.py'), Buffer.from([0x23, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a]));
    await writeFile(path.join(dir, 'blob.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3, 0xff, 0xfe, 0, 0, 0x10, 0x11]));

    expect(await call('read', { path: 'utf8.py' })).toMatchObject({ ok: true, content: text, encoding: 'utf-8' });
    expect(await call('read', { path: 'utf16.py' })).toMatchObject({ ok: true, content: text, encoding: 'utf-16le', bom: true });
    expect(await call('read', { path: 'nul.py' })).toMatchObject({ ok: true, content: 'x = 1\u0000\n', note: expect.stringContaining('NUL') });
    expect(await call('read', { path: 'gbk.py' })).toMatchObject({ ok: true, content: '# 中文\n', encoding: 'gb18030' });
    expect(await call('read', { path: 'blob.bin' })).toMatchObject({ ok: true, binary: true, size: 16 });
    // An explicit base64 read still returns the raw bytes.
    expect(await call('read', { path: 'nul.py', encoding: 'base64' })).toMatchObject({ content: Buffer.from('x = 1\u0000\n').toString('base64') });
    // Larger files are read in parts; each part is decoded and placed within the file.
    expect(await call('read', { path: 'utf8.py', offset: 0, length: 14 })).toMatchObject({ ok: true, content: 'def version():', size: Buffer.byteLength(text), offset: 0, eof: false });

    // Delivery and audit records hold the same exact result, in a form jsonb accepts.
    const log = db.localBridgeOperationLog.rows.find((r: any) => r.args?.path === 'nul.py' && !r.args.encoding);
    expect(JSON.stringify(log.result)).not.toMatch(UNSAFE);
    expect(decodeStoredJson(log.result)).toMatchObject({ content: 'x = 1\u0000\n' });
    expect(summarizeLocalOperation({ ...log, status: 'completed' })).toMatchObject({ ok: true, target: expect.stringContaining('nul.py') });
  });

  it('edits keep the file encoding and refuse encodings they cannot write back', async () => {
    await writeFile(path.join(dir, 'utf16.py'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a = "旧"\n', 'utf16le')]));
    expect(await call('edit', { path: 'utf16.py', old_text: '"旧"', new_text: '"新"' })).toMatchObject({ ok: true, edited: true, replacements: 1, encoding: 'utf-16le' });
    expect(await readFile(path.join(dir, 'utf16.py'))).toEqual(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a = "新"\n', 'utf16le')]));

    const gbk = Buffer.from([0x23, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a]);
    await writeFile(path.join(dir, 'gbk.py'), gbk);
    expect(await call('edit', { path: 'gbk.py', old_text: '中文', new_text: 'x' })).toMatchObject({ ok: false, error: 'EDIT_ENCODING_UNSUPPORTED' });
    expect(await readFile(path.join(dir, 'gbk.py'))).toEqual(gbk);
    expect(await call('edit', { path: 'utf16.py', old_text: 'missing', new_text: 'x' })).toMatchObject({ ok: false, error: 'EDIT_MATCH_MUST_BE_UNIQUE' });
    // Command output arrives as bytes from the desktop client and is decoded on the server.
    expect(await call('exec', { command: "printf 'caf\\303\\251 \\326\\320\\n'", yield_ms: 2000 })).toMatchObject({ ok: true, output: expect.stringMatching(/^caf/) });
    expect(db.localBridgeOperationLog.rows.filter((r: any) => r.op === 'edit').map((r: any) => decodeStoredJson(r.result)?.ok)).toEqual([true, false, false]);
  });

  it('isolates a result the server cannot accept: explicit failure, device stays online, next read works (acceptances 2 and 4)', async () => {
    await writeFile(path.join(dir, 'a.txt'), 'hello');
    const bad = crypto.randomUUID();
    db.failCompletion = (id: string, data: any) => { if (id === bad && data.result?.ok !== false) throw Object.assign(new Error('unsupported Unicode escape sequence'), { code: 'P2023' }); };
    const failed = await call('read', { path: 'a.txt' }, bad);
    expect(failed).toMatchObject({ ok: false, error: RESULT_DELIVERY_FAILED, reason: expect.stringContaining('RESULT_NOT_STORABLE') });
    expect(failed.message).toMatch(/still connected/);
    // The admin record states the same reason, and the device is not reported offline.
    expect(summarizeLocalOperation({ ...db.localBridgeOperationLog.rows.find((r: any) => r.id === bad), status: 'completed' })).toMatchObject({ ok: false, error: RESULT_DELIVERY_FAILED });
    expect(Date.now() - device.lastSeenAt.getTime()).toBeLessThan(15000);
    expect(await call('read', { path: 'a.txt' })).toMatchObject({ ok: true, content: 'hello' });
  });

  it('retries a transient server error with the same result and never re-executes the command (acceptance 3)', async () => {
    let outages = 2;
    db.failCompletion = () => { if (outages-- > 0) throw new Error("Can't reach database server"); };
    const command = process.platform === 'win32' ? 'echo run>> runs.txt' : 'echo run >> runs.txt';
    expect(await call('exec', { command, yield_ms: 2000 })).toMatchObject({ ok: true, exit_code: 0 });
    expect((await readFile(path.join(dir, 'runs.txt'), 'utf8')).trim().split('\n')).toHaveLength(1);
    expect(executions).toBe(1);
  });

  it('a restarted client delivers the journaled result instead of running the command again (acceptance 3)', async () => {
    stop.abort(); await transport;
    const id = crypto.randomUUID();
    const command = process.platform === 'win32' ? 'echo run>> runs.txt' : 'echo run >> runs.txt';
    const first = createExecutor({ getRoots: async () => [{ id: 'root-1', path: dir }], journalDir: journal });
    await first.execute({ id, op: 'exec', args: { command, yield_ms: 2000 }, rootId: 'root-1', threadId: 'thread-1' });
    // The result was never delivered; the app restarts and the server re-leases the same request id.
    await startClient();
    expect(await call('exec', { command, yield_ms: 2000 }, id)).toMatchObject({ ok: true, exit_code: 0 });
    expect((await readFile(path.join(dir, 'runs.txt'), 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('recovers an edit by request id without reporting it missing', async () => {
    await writeFile(path.join(dir, 'a.txt'), 'one');
    const id = crypto.randomUUID();
    await call('edit', { path: 'a.txt', old_text: 'one', new_text: 'two' }, id);
    expect(await recoverLocalRequest(db, binding, id)).toMatchObject({ ok: true, edited: true });
    const missed = crypto.randomUUID();
    await call('edit', { path: 'a.txt', old_text: 'absent', new_text: 'x' }, missed);
    expect(await recoverLocalRequest(db, binding, missed)).toMatchObject({ ok: false, error: 'EDIT_NOT_APPLIED' });
  });
});

describe('results the body parser rejects', () => {
  it('fails the leased command explicitly and acknowledges, keeping the device online', async () => {
    const { db, device } = fakeDb();
    device.lastSeenAt = new Date(Date.now() - 60000);
    db.localBridgeCommand.rows.push({ id: 'cmd-big', deviceId: device.id, status: 'leased', lease: 'l', leaseUntil: new Date(), createdAt: new Date(), op: 'read', args: {} });
    db.localBridgeOperationLog.rows.push({ id: 'cmd-big', status: 'pending' });
    const app = express();
    app.use('/api/local-bridge', express.json({ limit: '1kb' }), localBridgeBodyErrorHandler(db));
    app.use('/api/local-bridge', createLocalBridgeRouter(db));
    await request(app).post('/api/local-bridge/agent/result').auth('device-token', { type: 'bearer' })
      .send({ id: 'cmd-big', lease: 'l', result: { ok: true, content: 'x'.repeat(5000) } })
      .expect(200, { acknowledged: true });
    const command = db.localBridgeCommand.rows[0];
    expect(command.status).toBe('completed');
    expect(decodeStoredJson(command.result)).toMatchObject({ ok: false, error: RESULT_DELIVERY_FAILED, reason: expect.stringContaining('RESULT_TOO_LARGE') });
    expect(decodeStoredJson(db.localBridgeOperationLog.rows[0].result)).toEqual(decodeStoredJson(command.result));
    expect(Date.now() - device.lastSeenAt.getTime()).toBeLessThan(15000);
  });
});

describe('outdated clients are refused work until they update', () => {
  const app = (db: any) => { const a = express(); a.use('/api/local-bridge', express.json(), createLocalBridgeRouter(db)); return a; };

  it('keeps an old client visible but gives it the update message instead of work', async () => {
    const { db, device } = fakeDb();
    device.lastSeenAt = new Date(Date.now() - 60000);
    db.localBridgeCommand.rows.push({ id: 'cmd-1', deviceId: device.id, status: 'pending', op: 'list', args: {}, deadline: new Date(Date.now() + 60000), createdAt: new Date() });
    const old = await request(app(db)).post('/api/local-bridge/agent/poll').auth('device-token', { type: 'bearer' }).send({}).expect(426);
    expect(old.body.detail).toContain('下载 0.3.0 新版');
    expect(device.clientVersion).toBeNull();
    expect(Date.now() - device.lastSeenAt.getTime()).toBeLessThan(5000);
    expect(db.localBridgeCommand.rows[0].status).toBe('pending');

    const current = await request(app(db)).post('/api/local-bridge/agent/poll').auth('device-token', { type: 'bearer' }).set('x-local-bridge-version', '0.3.0').send({}).expect(200);
    expect(current.body.command).toMatchObject({ id: 'cmd-1' });
    expect(device.clientVersion).toBe('0.3.0');
  });

  it('tells Linux command-line users to re-run the connection command', async () => {
    const { db, device } = fakeDb();
    (device as any).platform = 'linux-cli';
    const old = await request(app(db)).post('/api/local-bridge/agent/poll').auth('device-token', { type: 'bearer' }).set('x-local-bridge-version', '0.2.3').send({}).expect(426);
    expect(old.body.detail).toContain('重新复制连接命令');
  });

  it('refuses agent tool calls on a computer whose client must update, with a message for the user', async () => {
    const { db, device } = fakeDb();
    (device as any).clientVersion = null;
    const binding = { id: 'binding-1', threadId: 'thread-1', rootId: 'root-1', root: { id: 'root-1', path: '/tmp', deviceId: device.id, device } };
    await expect(runLocalTool(db, binding, 'list', { path: '.' }, crypto.randomUUID())).rejects.toThrow(/LOCAL_CLIENT_UPDATE_REQUIRED.*下载 0\.3\.0 新版/);
    expect(db.localBridgeCommand.rows).toHaveLength(0);
    expect(bindingOut(binding)).toMatchObject({ update_required: true });
  });

  it('compares versions numerically', () => {
    expect(clientVersionOutdated('0.3.0')).toBe(false);
    expect(clientVersionOutdated('0.10.0')).toBe(false);
    expect(clientVersionOutdated('0.2.9')).toBe(true);
    expect(clientVersionOutdated(null)).toBe(true);
  });
});
