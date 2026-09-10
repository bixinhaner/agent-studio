import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalBridgeRouter } from './local-bridge-router.js';
import { bindingToken, buildLocalRuntime, cancelLocalTask, localBridgeBinding } from './local-bridge-service.js';
const require = createRequire(import.meta.url);
const { createExecutor } = require('../../packages/local-bridge/runtime/executor.cjs');
const testUrl = process.env.LOCAL_BRIDGE_TEST_DATABASE_URL;
describe.skipIf(!testUrl)('Local computer durable integration (isolated PostgreSQL)', () => {
  const db = new PrismaClient({ datasources: { db: { url: testUrl || 'postgresql://localhost/unused' } } });
  const userId = `bridge-test-${randomUUID()}`; const otherId = `bridge-test-${randomUUID()}`;
  const rootDir = path.resolve('../temp/local-bridge-integration', userId);
  const threadId = randomUUID();
  let deviceId: string, token: string, rootId: string;
  function app() {
    const server = express(); server.use(express.json({ limit: '4mb' }));
    server.use((req, _res, next) => { if (req.header('x-test-user')) { req.currentUser = { id: req.header('x-test-user') } as any; req.currentOrganization = { id: 'test-org' } as any; } next(); });
    server.use('/api/local-bridge', createLocalBridgeRouter(db)); return server;
  }
  const portal = app(), relay = app();
  beforeAll(async () => {
    await fs.mkdir(rootDir, { recursive: true });
    await db.user.createMany({ data: [{ id: userId }, { id: otherId }] });
    await db.thread.create({ data: { id: threadId, userId, organizationId: 'test-org', channel: 'portal', workspace: '/cloud/test/' + userId } });
  });
  afterAll(async () => { await db.thread.deleteMany({ where: { id: threadId } }); await db.localBridgeConnection.deleteMany({ where: { userId: { in: [userId, otherId] } } }); await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } }); await db.$disconnect(); await fs.rm(rootDir, { recursive: true, force: true }); });
  it('one-use pairing works between independent Portal and Relay instances; online alone injects no tools', async () => {
    const connection = await request(portal).post('/api/local-bridge/connections').set('x-test-user', userId).expect(201);
    const attempts = await Promise.all([1, 2].map(() => request(relay).post('/api/local-bridge/agent/pair').send({ code: connection.body.code, name: 'Test computer', platform: process.platform })));
    expect(attempts.map(r => r.status).sort()).toEqual([201, 400]);
    const paired = attempts.find(r => r.status === 201)!.body; token = paired.token; deviceId = paired.device_id;
    expect(await buildLocalRuntime(db, 'http://localhost', userId, '/cloud/test/' + userId)).toBeUndefined();
    const root = await request(relay).post('/api/local-bridge/agent/roots').auth(token, { type: 'bearer' }).send({ path: rootDir, label: 'Test folder' }).expect(201); rootId = root.body.root.id;
    await request(relay).post('/api/local-bridge/agent/complete').auth(token, { type: 'bearer' }).send({ connection_id: paired.connection_id, root_id: rootId }).expect(200);
    expect((await request(portal).get('/api/local-bridge/connections/' + connection.body.id).set('x-test-user', userId)).body.selection.root_id).toBe(rootId);
    await request(portal).put(`/api/local-bridge/threads/${threadId}/binding`).set('x-test-user', otherId).send({ root_id: rootId }).expect(404);
    await request(portal).put(`/api/local-bridge/threads/${threadId}/binding`).set('x-test-user', userId).send({ root_id: rootId }).expect(200);
    const runtime = await buildLocalRuntime(db, 'http://localhost', userId, '/cloud/test/' + userId); expect(runtime?.hint).toContain('not an OS sandbox'); expect(runtime?.server).toBeDefined();
  });
  it('MCP -> durable Relay -> actual local executor -> result; claim once, stale results ignored', async () => {
    const binding = await localBridgeBinding(db, threadId); const auth = bindingToken(binding);
    const listed = await request(portal).post('/api/local-bridge/mcp/rpc').auth(auth, { type: 'bearer' }).send({ rpc: { id: 1, method: 'tools/list' } }).expect(200);
    expect(listed.body.result.tools.map((t: any) => t.name)).toContain('local_exec');
    const id = randomUUID();
    const rpc = request(portal).post('/api/local-bridge/mcp/rpc').auth(auth, { type: 'bearer' }).send({ request_id: id, rpc: { id: 2, method: 'tools/call', params: { name: 'local_write', arguments: { path: 'proof.txt', content: 'local round trip' } } } }).then(r => r);
    let command: any;
    for (let i = 0; i < 30 && !command; i++) { const polled = await request(relay).post('/api/local-bridge/agent/poll').auth(token, { type: 'bearer' }); command = polled.body.command; if (!command) await new Promise(r => setTimeout(r, 100)); }
    expect(command.id).toBe(id);
    expect((await request(relay).post('/api/local-bridge/agent/poll').auth(token, { type: 'bearer' })).body.command).toBeNull();
    await request(relay).post('/api/local-bridge/agent/result').auth(token, { type: 'bearer' }).send({ id, lease: 'stale', result: { ok: true } }).expect(200);
    expect((await db.localBridgeCommand.findUnique({ where: { id } }))!.status).toBe('leased');
    const executor = createExecutor({ getRoots: () => [{ id: rootId, path: rootDir }], journalDir: path.join(rootDir, 'receipts') });
    const result = await executor.execute(command);
    await request(relay).post('/api/local-bridge/agent/result').auth(token, { type: 'bearer' }).send({ id, lease: command.lease, result }).expect(200);
    expect((await rpc).body.result.isError).toBe(false); expect(await fs.readFile(path.join(rootDir, 'proof.txt'), 'utf8')).toBe('local round trip');
    const recovered = await request(portal).post('/api/local-bridge/mcp/rpc').auth(auth, { type: 'bearer' }).send({ rpc: { id: 3, method: 'tools/call', params: { name: 'local_request_result', arguments: { request_id: id } } } }).expect(200);
    expect(recovered.body.result.isError).toBe(false);
  });
  it('offline retains binding/tools and rejects new execution; detach revokes old MCP credentials', async () => {
    const binding = await localBridgeBinding(db, threadId); const auth = bindingToken(binding);
    await db.localBridgeDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date(0) } });
    const view = await request(portal).get(`/api/local-bridge/threads/${threadId}/binding`).set('x-test-user', userId).expect(200); expect(view.body.binding.status).toBe('offline');
    expect(await buildLocalRuntime(db, 'http://localhost', userId, '/cloud/test/' + userId)).toBeDefined();
    const response = await request(portal).post('/api/local-bridge/mcp/rpc').auth(auth, { type: 'bearer' }).send({ request_id: randomUUID(), rpc: { id: 4, method: 'tools/call', params: { name: 'local_exec', arguments: { command: 'echo test' } } } }).expect(400);
    expect(response.body.detail).toContain('LOCAL_COMPUTER_OFFLINE');
    await cancelLocalTask(db, threadId); expect(await db.localBridgeCommand.count({ where: { threadId, op: 'cancel_task' } })).toBeGreaterThan(0);
    await request(portal).put(`/api/local-bridge/threads/${threadId}/binding`).set('x-test-user', userId).send({ root_id: null }).expect(200);
    await request(portal).post('/api/local-bridge/mcp/rpc').auth(auth, { type: 'bearer' }).send({ rpc: { id: 5, method: 'tools/list' } }).expect(401);
    expect(await buildLocalRuntime(db, 'http://localhost', userId, '/cloud/test/' + userId)).toBeUndefined();
  });
});
