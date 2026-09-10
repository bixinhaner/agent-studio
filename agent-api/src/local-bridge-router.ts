import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticateBinding, bindLocalRoot, bindingOut, bridgeHash, bridgeOnline, enqueueLocalCommand, localBridgeBinding, waitLocalCommand } from './local-bridge-service.js';
import { localBridgeTools } from './local-bridge-tools.js';
const rootInclude = { roots: true };
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => { void fn(req, res).catch(error => res.status(error.status || (error instanceof z.ZodError ? 400 : 400)).json({ detail: error.message || 'Local computer request failed' })); };
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const bearer = (req: Request) => req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
function user(req: Request) { if (!req.currentUser || !req.currentOrganization) return fail('Unauthorized', 401); return req.currentUser; }
function selection(root: any) { return bindingOut({ id: `selection-${root.id}`, rootId: root.id, root }); }
export function createLocalBridgeRouter(db: any, options: { isTaskRunning?: (threadId: string) => boolean } = {}) {
  const router = Router();
  let nextCleanupAt = 0;
  router.use((_req, _res, next) => {
    if (Date.now() > nextCleanupAt && db.localBridgeCommand?.deleteMany) {
      nextCleanupAt = Date.now() + 3600000;
      const cutoff = new Date(Date.now() - 86400000);
      void Promise.all([
        db.localBridgeCommand.deleteMany({ where: { deadline: { lt: cutoff } } }),
        db.localBridgeConnection.deleteMany({ where: { expiresAt: { lt: cutoff } } })
      ]).catch(() => {});
    }
    next();
  });
  async function agent(req: Request) {
    if (!bearer(req)) return fail('Missing device token', 401);
    const d = await db.localBridgeDevice.findFirst({ where: { tokenHash: bridgeHash(bearer(req)), status: 'active' }, include: rootInclude });
    if (!d) return fail('Invalid device token', 401);
    return d;
  }
  async function ownedThread(req: Request) {
    const u = user(req);
    const t = await db.thread.findFirst({ where: { id: req.params.threadId, userId: u.id, organizationId: req.currentOrganization!.id, channel: 'portal' } });
    if (!t) return fail('Task not found', 404);
    return t;
  }
  router.get('/devices', wrap(async (req, res) => {
    const devices = await db.localBridgeDevice.findMany({ where: { userId: user(req).id }, include: rootInclude, orderBy: { createdAt: 'desc' } });
    res.json({ devices: devices.map((d: any) => ({ id: d.id, name: d.name, platform: d.platform, status: bridgeOnline(d) ? 'online' : 'offline', last_seen_at: d.lastSeenAt, roots: d.roots.map((r: any) => ({ id: r.id, path: r.path, label: r.label })) })) });
  }));
  router.post(['/connections', '/devices/pairing'], wrap(async (req, res) => {
    const input = z.object({ return_url: z.string().url().optional(), thread_id: z.string().optional() }).parse(req.body || {});
    let returnUrl: string | undefined;
    if (input.return_url) {
      const url = new URL(input.return_url);
      if (url.protocol !== 'https:' || !['bailey.baicells.com', 'aiagent.indonesiacentral.cloudapp.azure.com'].includes(url.hostname)) return fail('Invalid Portal return address');
      url.searchParams.delete('local_connection'); returnUrl = url.toString();
    }
    if (input.thread_id && !await db.thread.findFirst({ where: { id: input.thread_id, userId: user(req).id, organizationId: req.currentOrganization!.id, channel: 'portal' } })) return fail('Task not found', 404);
    const code = randomBytes(5).toString('hex').toUpperCase();
    const c = await db.localBridgeConnection.create({ data: { userId: user(req).id, returnUrl, threadId: input.thread_id, tokenHash: bridgeHash(code), expiresAt: new Date(Date.now() + 10 * 60000) } });
    res.status(201).json({ id: c.id, code, expires_at: c.expiresAt, launch_url: `agent-studio://connect?code=${code}` });
  }));
  router.get('/connections/:id', wrap(async (req, res) => {
    const c = await db.localBridgeConnection.findFirst({ where: { id: req.params.id, userId: user(req).id } });
    if (!c) return fail('Connection not found', 404);
    const root = c.rootId && await db.localBridgeRoot.findFirst({ where: { id: c.rootId, device: { userId: user(req).id } }, include: { device: true } });
    res.json({ thread_id: c.threadId, status: ['pending', 'claimed'].includes(c.status) && c.expiresAt < new Date() ? 'expired' : c.status, selection: root ? selection(root) : null });
  }));
  router.delete('/connections/:id', wrap(async (req, res) => {
    await db.localBridgeConnection.updateMany({ where: { id: req.params.id, userId: user(req).id, status: { in: ['pending', 'claimed'] } }, data: { status: 'cancelled' } }); res.status(204).end();
  }));
  router.delete('/devices/:id', wrap(async (req, res) => {
    await db.localBridgeDevice.deleteMany({ where: { id: req.params.id, userId: user(req).id } }); res.status(204).end();
  }));
  router.get('/threads/:threadId/binding', wrap(async (req, res) => { const t = await ownedThread(req); res.json({ binding: bindingOut(await localBridgeBinding(db, t.id)) }); }));
  router.put('/threads/:threadId/binding', wrap(async (req, res) => {
    const t = await ownedThread(req);
    if (options.isTaskRunning?.(t.id)) return fail('请先停止当前任务，再切换工作目录。', 409);
    const rootId = z.string().min(1).nullable().parse(req.body.root_id);
    res.json({ binding: bindingOut(await bindLocalRoot(db, user(req).id, t.id, rootId)) });
  }));
  router.post('/threads/:threadId/stop', wrap(async (req, res) => { const t = await ownedThread(req); const { cancelLocalTask } = await import('./local-bridge-service.js'); await cancelLocalTask(db, t.id); res.json({ stopped: true }); }));
  router.post('/threads/:threadId/open', wrap(async (req, res) => {
    const t = await ownedThread(req); const binding = await localBridgeBinding(db, t.id); if (!binding) return fail('No local folder', 404);
    const command = await enqueueLocalCommand(db, binding, 'open', { path: z.string().min(1).max(4096).parse(req.body.path) });
    res.json(await waitLocalCommand(db, command.id));
  }));
  router.get('/threads/:threadId/file', wrap(async (req, res) => {
    const t = await ownedThread(req); const binding = await localBridgeBinding(db, t.id); if (!binding) return fail('No local folder', 404);
    const command = await enqueueLocalCommand(db, binding, 'read', { path: z.string().parse(req.query.path), encoding: 'base64' });
    const result = await waitLocalCommand(db, command.id);
    if (!result?.ok) return res.status(409).json(result);
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', 'attachment'); res.setHeader('Cache-Control', 'no-store'); res.send(Buffer.from(result.content, 'base64'));
  }));
  router.post('/agent/pair', wrap(async (req, res) => {
    const input = z.object({ code: z.string(), name: z.string().min(1).max(120), platform: z.string().max(80).optional() }).parse(req.body);
    const token = `asb_${randomBytes(32).toString('base64url')}`;
    const result = await db.$transaction(async (tx: any) => {
      const c = await tx.localBridgeConnection.findUnique({ where: { tokenHash: bridgeHash(input.code.trim().toUpperCase()) } });
      if (!c || c.status !== 'pending' || c.expiresAt < new Date()) return fail('连接已过期，请在 Portal 重新打开客户端。');
      let device = bearer(req) && await tx.localBridgeDevice.findFirst({ where: { tokenHash: bridgeHash(bearer(req)), status: 'active' } });
      if (device && device.userId !== c.userId) return fail('客户端连接的是另一个账号，请先在客户端退出连接。', 409);
      const claimed = await tx.localBridgeConnection.updateMany({ where: { id: c.id, status: 'pending' }, data: { status: 'claimed' } });
      if (!claimed.count) return fail('连接已使用，请重新打开客户端。');
      if (!device) device = await tx.localBridgeDevice.create({ data: { userId: c.userId, name: input.name, platform: input.platform, status: 'active', tokenHash: bridgeHash(token), lastSeenAt: new Date() } });
      await tx.localBridgeConnection.update({ where: { id: c.id }, data: { deviceId: device.id } });
      return { device_id: device.id, token: bearer(req) && device.tokenHash === bridgeHash(bearer(req)) ? bearer(req) : token, connection_id: c.id, return_url: c.returnUrl ? (() => { const url = new URL(c.returnUrl); url.searchParams.set("local_connection", c.id); return url.toString(); })() : undefined };
    });
    res.status(201).json(result);
  }));
  router.post('/agent/roots', wrap(async (req, res) => {
    const d = await agent(req); const input = z.object({ path: z.string().min(1).max(4096), label: z.string().max(120).optional() }).parse(req.body);
    const root = await db.localBridgeRoot.upsert({ where: { deviceId_path: { deviceId: d.id, path: input.path } }, update: { label: input.label }, create: { deviceId: d.id, ...input } });
    res.status(201).json({ root: { id: root.id, path: root.path, label: root.label } });
  }));
  router.post('/agent/complete', wrap(async (req, res) => {
    const d = await agent(req); const input = z.object({ connection_id: z.string(), root_id: z.string().nullable() }).parse(req.body);
    if (input.root_id && !d.roots.some((r: any) => r.id === input.root_id)) return fail('Folder not found');
    const updated = await db.localBridgeConnection.updateMany({ where: { id: input.connection_id, deviceId: d.id, status: 'claimed', expiresAt: { gt: new Date() } }, data: { status: input.root_id ? 'completed' : 'cancelled', rootId: input.root_id } });
    if (!updated.count) return fail('选择已过期，请回到 Portal 重新选择。', 409); res.json({ ok: true });
  }));
  router.post('/agent/poll', wrap(async (req, res) => {
    const d = await agent(req);
    if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > 4000) await db.localBridgeDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
    const now = new Date();
    const eligible = { deviceId: d.id, deadline: { gt: now }, OR: [{ status: 'pending' }, { status: 'leased', leaseUntil: { lt: now } }] };
    for (let i = 0; i < 3; i++) {
      const command = await db.localBridgeCommand.findFirst({ where: eligible, orderBy: [{ op: 'asc' }, { createdAt: 'asc' }] });
      if (!command) break;
      // A cancelled/replaced binding can never authorize queued work on a different folder.
      if (command.bindingId && !await db.localBridgeBinding.findUnique({ where: { id: command.bindingId } })) { await db.localBridgeCommand.update({ where: { id: command.id }, data: { status: 'cancelled' } }); continue; }
      const lease = randomUUID();
      const claimed = await db.localBridgeCommand.updateMany({ where: { id: command.id, ...eligible }, data: { status: 'leased', lease, leaseUntil: new Date(Date.now() + 30000) } });
      if (claimed.count) return res.json({ command: { id: command.id, op: command.op, args: command.args, rootId: command.rootId, threadId: command.threadId, lease } });
    }
    res.json({ command: null });
  }));
  router.post('/agent/result', wrap(async (req, res) => {
    const d = await agent(req); const input = z.object({ id: z.string(), lease: z.string(), result: z.record(z.unknown()) }).parse(req.body);
    await db.localBridgeCommand.updateMany({ where: { id: input.id, deviceId: d.id, status: 'leased', lease: input.lease }, data: { status: 'completed', result: input.result, args: {} } });
    res.json({ acknowledged: true });
  }));
  router.post('/mcp/rpc', wrap(async (req, res) => {
    const binding = await authenticateBinding(db, bearer(req)); if (!binding) return fail('Local task binding expired. Refresh the task connection.', 401);
    const rpc = req.body.rpc || {}; let result: any;
    if (rpc.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'local_computer', version: '0.2.0' } };
    else if (rpc.method === 'tools/list') result = { tools: localBridgeTools };
    else if (rpc.method === 'ping') result = {};
    else if (rpc.method === 'tools/call') {
      const name = rpc.params?.name; const args = rpc.params?.arguments || {};
      if (!localBridgeTools.some(t => t.name === name)) return fail('Unknown local tool');
      let output;
      if (name === 'local_request_result') {
        const command = await db.localBridgeCommand.findFirst({ where: { id: String(args.request_id), bindingId: binding.id } });
        output = command ? await waitLocalCommand(db, command.id) : { ok: false, error: 'REQUEST_NOT_FOUND' };
      } else {
        const requestId = z.string().uuid().parse(req.body.request_id);
        const command = await enqueueLocalCommand(db, binding, name.slice(6), args, requestId);
        if (command.bindingId !== binding.id) return fail('Request does not belong to this task', 403);
        output = await waitLocalCommand(db, command.id);
      }
      result = { content: [{ type: 'text', text: JSON.stringify(output) }], isError: output?.ok === false };
    } else return res.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } });
    res.json({ jsonrpc: '2.0', id: rpc.id, result });
  }));
  return router;
}
