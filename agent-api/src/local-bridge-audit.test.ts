import { describe, expect, it } from 'vitest';
import { bindLocalRoot, cancelLocalTask, enqueueLocalCommand } from './local-bridge-service.js';
import { completeLocalOperation } from './local-bridge-audit.js';

function fakeDb() {
  const device = { id: 'dev-1', userId: 'user-1', name: 'Like MacBook', platform: 'darwin', status: 'active', lastSeenAt: new Date() };
  const roots = [
    { id: 'root-a', deviceId: 'dev-1', path: '/Users/like/a', label: null, device },
    { id: 'root-b', deviceId: 'dev-1', path: '/Users/like/b', label: 'Project B', device }
  ];
  const thread = { id: 'thread-1', userId: 'user-1', channel: 'portal' };
  let binding: any = null;
  const commands = new Map<string, any>();
  const logs = new Map<string, any>();
  const events: any[] = [];
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) =>
    value && typeof value === 'object' && 'in' in value ? value.in.includes(row[key]) : row[key] === value);
  const db: any = {
    thread: { findFirst: async () => thread },
    localBridgeRoot: { findFirst: async ({ where }: any) => roots.find(root => root.id === where.id) ?? null },
    localBridgeBinding: {
      findUnique: async () => binding && { ...binding, thread, root: roots.find(root => root.id === binding.rootId) },
      deleteMany: async () => { binding = null; },
      create: async ({ data }: any) => { binding = { id: `binding-${data.rootId}`, ...data }; return binding; }
    },
    localBridgeCommand: {
      upsert: async ({ where, create }: any) => { if (!commands.has(where.id)) commands.set(where.id, { status: 'pending', createdAt: new Date(), ...create }); return commands.get(where.id); },
      updateMany: async ({ where, data }: any) => { for (const row of commands.values()) if (matches(row, where)) Object.assign(row, data); },
      create: async ({ data }: any) => { commands.set(data.id, { status: 'pending', ...data }); }
    },
    localBridgeOperationLog: {
      upsert: async ({ where, create }: any) => { if (!logs.has(where.id)) logs.set(where.id, { status: 'pending', ...create }); },
      updateMany: async ({ where, data }: any) => { for (const row of logs.values()) if (matches(row, where)) Object.assign(row, data); }
    },
    localBridgeBindingEvent: { create: async ({ data }: any) => { events.push(data); } },
    $transaction: async (fn: any) => fn(db)
  };
  return { db, logs, events, commands };
}

describe('local computer audit trail', () => {
  it('records bind, switch and unbind with device and folder snapshots', async () => {
    const { db, events } = fakeDb();
    await bindLocalRoot(db, 'user-1', 'thread-1', 'root-a');
    await bindLocalRoot(db, 'user-1', 'thread-1', 'root-a');
    await bindLocalRoot(db, 'user-1', 'thread-1', 'root-b');
    await bindLocalRoot(db, 'user-1', 'thread-1', null);
    await bindLocalRoot(db, 'user-1', 'thread-1', null);
    expect(events.map(event => event.kind)).toEqual(['bound', 'switched', 'unbound']);
    expect(events[1]).toMatchObject({ fromPath: '/Users/like/a', fromLabel: 'a', toPath: '/Users/like/b', toLabel: 'Project B', toDeviceName: 'Like MacBook', toPlatform: 'darwin' });
    expect(events[2]).toMatchObject({ fromPath: '/Users/like/b', toPath: null });
  });

  it('keeps full args and results after the delivery row clears them', async () => {
    const { db, logs, commands } = fakeDb();
    await bindLocalRoot(db, 'user-1', 'thread-1', 'root-a');
    const binding = await db.localBridgeBinding.findUnique({});
    const content = 'x'.repeat(50_000);
    await enqueueLocalCommand(db, binding, 'write', { path: 'big.txt', content }, 'req-1');
    await enqueueLocalCommand(db, binding, 'open', { path: 'big.txt' }, 'req-2', 'portal');
    commands.get('req-1').args = {};
    await completeLocalOperation(db, 'req-1', { ok: true, path: '/Users/like/a/big.txt' });
    expect(logs.get('req-1')).toMatchObject({ source: 'agent', op: 'write', status: 'completed', deviceName: 'Like MacBook', rootPath: '/Users/like/a', userId: 'user-1', result: { ok: true, path: '/Users/like/a/big.txt' } });
    expect(logs.get('req-1').args.content).toHaveLength(50_000);
    expect(logs.get('req-2')).toMatchObject({ source: 'portal', op: 'open', status: 'pending' });
    await cancelLocalTask(db, 'thread-1');
    expect(logs.get('req-2').status).toBe('cancelled');
    expect(logs.get('req-1').status).toBe('completed');
  });
});
