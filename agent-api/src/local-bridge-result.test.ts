import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { bridgeHash } from './local-bridge-service.js';
import { createLocalBridgeRouter } from './local-bridge-router.js';
import { NUL_REMOVED_NOTE, storableLocalResult } from './local-bridge-result.js';

describe('storableLocalResult', () => {
  it('removes NUL characters jsonb rejects and tells the agent how to get exact bytes', () => {
    // A UTF-16LE file decoded as UTF-8: ASCII letters separated by NULs.
    const utf16 = Buffer.from('print("v1")\n', 'utf16le').toString('utf8');
    const result = storableLocalResult({ ok: true, path: 'E:\\code\\get_omc_version.py', content: utf16, encoding: 'utf8' });
    expect(result.content).toBe('print("v1")\n');
    expect(result.warning).toBe(NUL_REMOVED_NOTE);
    expect(JSON.stringify(result)).not.toContain('\\u0000');
  });

  it('cleans nested values and keys, and leaves clean results untouched', () => {
    const nested = storableLocalResult({ ok: true, entries: [{ name: 'a\u0000b' }], ['k\u0000']: 'x', lone: 'a\uD800b' });
    expect(nested).toMatchObject({ entries: [{ name: 'ab' }], k: 'x', lone: 'a�b', warning: NUL_REMOVED_NOTE });
    const clean = { ok: true, output: '中文 ✓ 😀', exit_code: 0 };
    expect(storableLocalResult(clean)).toEqual(clean);
  });
});

describe('local bridge result delivery', () => {
  function relay(updateMany: (args: any) => Promise<{ count: number }>) {
    const token = 'device-token';
    const db = {
      localBridgeDevice: {
        findFirst: vi.fn(async ({ where }: any) => (where.tokenHash === bridgeHash(token) ? { id: 'device-1', roots: [] } : null)),
        update: vi.fn(async () => ({}))
      },
      localBridgeCommand: { updateMany: vi.fn(updateMany) },
      localBridgeOperationLog: { updateMany: vi.fn(async (_args: any) => ({ count: 1 })) }
    };
    const app = express();
    app.use(express.json({ limit: '20mb' }));
    app.use('/api/local-bridge', createLocalBridgeRouter(db));
    return { app, db, token };
  }

  it('stores a cleaned result and acknowledges it', async () => {
    const { app, db, token } = relay(async () => ({ count: 1 }));
    await request(app)
      .post('/api/local-bridge/agent/result')
      .auth(token, { type: 'bearer' })
      .send({ id: 'cmd-1', lease: 'lease-1', result: { ok: true, content: 'a\u0000b' } })
      .expect(200, { acknowledged: true });
    const stored = db.localBridgeCommand.updateMany.mock.calls[0][0].data.result;
    expect(stored).toMatchObject({ ok: true, content: 'ab', warning: NUL_REMOVED_NOTE });
    expect(db.localBridgeOperationLog.updateMany.mock.calls[0]?.[0].data.result).toEqual(stored);
  });

  it('acknowledges with a failure result when the result still cannot be stored', async () => {
    let calls = 0;
    const { app, db, token } = relay(async () => {
      calls += 1;
      if (calls === 1) throw new Error('unsupported Unicode escape sequence');
      return { count: 1 };
    });
    await request(app)
      .post('/api/local-bridge/agent/result')
      .auth(token, { type: 'bearer' })
      .send({ id: 'cmd-2', lease: 'lease-2', result: { ok: true, content: 'x' } })
      .expect(200, { acknowledged: true });
    expect(db.localBridgeCommand.updateMany.mock.calls[1][0].data.result).toMatchObject({ ok: false, error: 'RESULT_NOT_STORABLE' });
  });
});
