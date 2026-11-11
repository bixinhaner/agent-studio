import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createLocalBridgeRouter } from './local-bridge-router.js';
import { bindConnectorRoot, bindLocalRoot, bindingToken, buildLocalRuntime, authenticateBinding, localBridgeBinding, pairConnectorDevice } from './local-bridge-service.js';

const testUrl = process.env.LOCAL_BRIDGE_TEST_DATABASE_URL;
const version = { 'x-local-bridge-version': '0.3.0' };

describe.skipIf(!testUrl)('Local Bridge service devices owned by an Action Connector (isolated PostgreSQL)', () => {
  const db = new PrismaClient({ datasources: { db: { url: testUrl || 'postgresql://localhost/unused' } } });
  const tag = randomUUID();
  const connectorId = `connector-${tag}`; const otherConnectorId = `connector-other-${tag}`;
  const userId = `bridge-svc-user-${tag}`;
  const connectorThread = randomUUID(); const otherConnectorThread = randomUUID(); const portalThread = randomUUID();
  const workspace = `/cloud/connector/${tag}`;
  let token: string, deviceId: string, rootId: string, userRootId: string;
  const server = express(); server.use(express.json({ limit: '4mb' }));
  server.use('/api/local-bridge', createLocalBridgeRouter(db));

  beforeAll(async () => {
    await db.user.create({ data: { id: userId } });
    await db.thread.create({ data: { id: connectorThread, workspace, codexRunConfig: { actionConnector: { integrationInstanceId: connectorId } } } });
    await db.thread.create({ data: { id: otherConnectorThread, workspace: workspace + '-other', codexRunConfig: { actionConnector: { integrationInstanceId: otherConnectorId } } } });
    await db.thread.create({ data: { id: portalThread, userId, channel: 'portal', workspace: workspace + '-portal' } });
    const userDevice = await db.localBridgeDevice.create({ data: { userId, name: 'User laptop', status: 'active' } });
    userRootId = (await db.localBridgeRoot.create({ data: { deviceId: userDevice.id, path: '/Users/someone/work' } })).id;
  });
  afterAll(async () => {
    const threads = [connectorThread, otherConnectorThread, portalThread];
    await db.localBridgeBindingEvent.deleteMany({ where: { threadId: { in: threads } } });
    await db.localBridgeCommand.deleteMany({ where: { threadId: { in: threads } } }).catch(() => undefined);
    await db.thread.deleteMany({ where: { id: { in: threads } } });
    await db.localBridgeDevice.deleteMany({ where: { OR: [{ integrationInstanceId: { in: [connectorId, otherConnectorId] } }, { userId }] } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it('pairs with connector credentials, keeps the device when its token is presented again, and speaks the ordinary client protocol', async () => {
    const first = await pairConnectorDevice(db, connectorId, { name: 'netopt-host', platform: 'linux' });
    expect(first.created).toBe(true); expect(first.token.startsWith('asb_')).toBe(true);
    token = first.token; deviceId = first.device_id;
    const again = await pairConnectorDevice(db, connectorId, { name: 'netopt-host-renamed' }, token);
    expect(again).toMatchObject({ created: false, device_id: deviceId, token });
    // A token of another connector's device is not an identity here: a new device is issued.
    const foreign = await pairConnectorDevice(db, otherConnectorId, { name: 'other-host' }, token);
    expect(foreign.created).toBe(true); expect(foreign.device_id).not.toBe(deviceId);
    await request(server).post('/api/local-bridge/agent/heartbeat').set(version).auth(token, { type: 'bearer' }).expect(200);
    const root = await request(server).post('/api/local-bridge/agent/roots').set(version).auth(token, { type: 'bearer' }).send({ path: '/srv/sessions/a', label: 'session a' }).expect(201);
    rootId = root.body.root.id;
  });

  it('binds only conversations of the owning connector, and only to its own folders', async () => {
    expect(await buildLocalRuntime(db, 'http://localhost', undefined, workspace, connectorId)).toBeUndefined();
    await expect(bindConnectorRoot(db, otherConnectorId, connectorThread, rootId)).rejects.toThrow(/does not belong/);
    await expect(bindConnectorRoot(db, otherConnectorId, otherConnectorThread, rootId)).rejects.toThrow(/LOCAL_ROOT_NOT_FOUND/);
    await expect(bindConnectorRoot(db, connectorId, portalThread, rootId)).rejects.toThrow(/does not belong/);
    await expect(bindConnectorRoot(db, connectorId, connectorThread, userRootId)).rejects.toThrow(/LOCAL_ROOT_NOT_FOUND/);
    await expect(bindLocalRoot(db, userId, portalThread, rootId)).rejects.toThrow();
    const binding = await bindConnectorRoot(db, connectorId, connectorThread, rootId);
    expect(binding.rootId).toBe(rootId);
    expect((await bindConnectorRoot(db, connectorId, connectorThread, rootId)).id).toBe(binding.id);
    const runtime = await buildLocalRuntime(db, 'http://localhost', undefined, workspace, connectorId);
    expect(runtime?.bindingId).toBe(binding.id); expect(runtime?.hint).toContain("business system's host"); expect(runtime?.server.env.AGENT_STUDIO_LOCAL_BRIDGE_TOKEN).toBeTruthy();
    expect(await buildLocalRuntime(db, 'http://localhost', undefined, workspace, otherConnectorId)).toBeUndefined();
    expect(await buildLocalRuntime(db, 'http://localhost', userId, workspace)).toBeUndefined();
  });

  it('serves MCP tools through the durable queue and rejects a binding whose owners were crossed by hand', async () => {
    const binding = await localBridgeBinding(db, connectorThread); const auth = bindingToken(binding);
    const listed = await request(server).post('/api/local-bridge/mcp/rpc').auth(auth, { type: 'bearer' }).send({ rpc: { id: 1, method: 'tools/list' } }).expect(200);
    expect(listed.body.result.tools.map((t: any) => t.name)).toContain('local_exec');
    const id = randomUUID();
    const rpc = request(server).post('/api/local-bridge/mcp/rpc').auth(auth, { type: 'bearer' }).send({ request_id: id, rpc: { id: 2, method: 'tools/call', params: { name: 'local_workspace_info', arguments: {} } } }).then(r => r);
    let command: any;
    for (let i = 0; i < 30 && !command; i++) { command = (await request(server).post('/api/local-bridge/agent/poll').set(version).auth(token, { type: 'bearer' })).body.command; if (!command) await new Promise(r => setTimeout(r, 100)); }
    expect(command?.id).toBe(id);
    await request(server).post('/api/local-bridge/agent/result').set(version).auth(token, { type: 'bearer' }).send({ id, lease: command.lease, result: { ok: true, root: '/srv/sessions/a' } }).expect(200);
    expect((await rpc).body.result.isError).toBe(false);
    // Rows forced together outside the service (a user's folder under a connector conversation) authenticate nothing.
    await db.localBridgeBinding.update({ where: { id: binding.id }, data: { rootId: userRootId } });
    const crossed = await localBridgeBinding(db, connectorThread);
    expect(await authenticateBinding(db, bindingToken(crossed))).toBeNull();
    await db.localBridgeBinding.update({ where: { id: binding.id }, data: { rootId } });
  });

  it('releases the binding on request and when the client withdraws the folder', async () => {
    expect(await bindConnectorRoot(db, connectorId, connectorThread, null)).toBeNull();
    expect(await buildLocalRuntime(db, 'http://localhost', undefined, workspace, connectorId)).toBeUndefined();
    await bindConnectorRoot(db, connectorId, connectorThread, rootId);
    await request(server).delete('/api/local-bridge/agent/roots/' + userRootId).set(version).auth(token, { type: 'bearer' }).expect(204);
    expect(await db.localBridgeRoot.findUnique({ where: { id: userRootId } })).not.toBeNull();
    await request(server).delete('/api/local-bridge/agent/roots/' + rootId).set(version).auth(token, { type: 'bearer' }).expect(204);
    expect(await localBridgeBinding(db, connectorThread)).toBeNull();
  });
});
