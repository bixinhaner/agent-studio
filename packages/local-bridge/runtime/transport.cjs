const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Outbound connection to the relay, split into three independent loops so one bad result
 * can never take the computer offline:
 * - heartbeat: proves the client is running, even while results are being retried;
 * - poll: claims work; tasks run one step at a time each, different tasks run side by side;
 * - delivery: an on-disk outbox; transient failures back off and retry, a result the server
 *   definitely rejects is replaced by an explicit failure so the agent is told what happened.
 * A redelivered command whose result is already known is never executed again.
 */
const sleep = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});
const backoff = (attempt, max = 30000) => Math.min(max, 1000 * 2 ** Math.min(attempt, 6)) * (0.75 + Math.random() * 0.5);
/** Errors that will repeat for the same request (bad request, too large); 401/408/429 are not. */
const deterministic = error => Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);
const SERIAL_EXEMPT = new Set(['cancel_task', 'choose_folder']);
const OUTBOX_MAX_AGE = 24 * 3600000;

/** User-facing wording for a failed request; raw network errors mean nothing to most users. */
function describeError(error) {
  const message = String(error?.message || error || '');
  if (error?.status === 401) return message || '连接已失效，请在 Portal 重新连接这台电脑。';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(message)) return '网络连接中断，正在自动重试…';
  if (/timeout|aborted due to timeout/i.test(message)) return '服务器响应超时，正在自动重试…';
  if (Number.isInteger(error?.status) && error.status >= 500) return '服务器暂时不可用，正在自动重试…';
  return message || '连接失败，正在自动重试…';
}

function createOutbox(dir) {
  const entries = new Map();
  const file = id => path.join(dir, `${id}.json`);
  return {
    entries,
    async load() {
      if (!dir) return;
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      for (const name of await fs.readdir(dir).catch(() => [])) {
        if (!name.endsWith('.json')) continue;
        try {
          const entry = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
          if (Date.now() - entry.createdAt > OUTBOX_MAX_AGE) await fs.rm(path.join(dir, name), { force: true });
          else entries.set(entry.id, { ...entry, attempts: 0, nextAt: 0 });
        } catch { await fs.rm(path.join(dir, name), { force: true }); }
      }
    },
    async put(entry) {
      entries.set(entry.id, entry);
      if (!dir) return;
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const temp = file(entry.id) + '.tmp';
      const { attempts, nextAt, ...persisted } = entry;
      await fs.writeFile(temp, JSON.stringify(persisted), { mode: 0o600 });
      await fs.rename(temp, file(entry.id));
    },
    async remove(id) { entries.delete(id); if (dir) await fs.rm(file(id), { force: true }); }
  };
}

function describeCommand(command) {
  const a = command.args || {};
  // The server prefixes Windows commands to switch the console to UTF-8; show what the agent ran.
  const target = command.op === 'exec' ? String(a.command || '').replace(/^chcp 65001>nul & /, '') : command.op === 'process' ? '' : String(a.path || '');
  return { id: command.id, op: command.op, threadId: command.threadId, target: target.slice(0, 300) };
}

async function runTransport({ api, executor, signal, onStatus = () => {}, onActivity = () => {}, outboxDir, heartbeatMs = 5000, idleMs = 1000, concurrency = 4 }) {
  const outbox = createOutbox(outboxDir);
  await outbox.load();
  const status = { connected: false, error: '', pendingDeliveries: outbox.entries.size, deliveryError: '', running: 0 };
  let last = '';
  const report = patch => {
    Object.assign(status, patch, { pendingDeliveries: outbox.entries.size, running: inflight.size });
    const key = JSON.stringify(status);
    if (key !== last) { last = key; onStatus({ ...status }); }
  };
  const inflight = new Map(); // id -> latest lease while executing
  const lanes = new Map(); // threadId -> tail promise
  const tasks = new Set();
  let wakeDelivery = () => {};
  let slotFreed = () => {};
  let heartbeatSupported = true;

  async function heartbeat() {
    while (!signal.aborted && heartbeatSupported) {
      try { await api('/api/local-bridge/agent/heartbeat', { method: 'POST', body: '{}' }); report({ connected: true, error: '' }); }
      catch (error) {
        if (error?.status === 404) { heartbeatSupported = false; break; } // older server: polling keeps the device online
        if (!signal.aborted || error?.status === 401) report({ connected: false, error: describeError(error) });
      }
      await sleep(heartbeatMs, signal);
    }
  }

  async function run(command) {
    const info = describeCommand(command);
    const startedAt = Date.now();
    onActivity({ ...info, state: 'running', startedAt });
    let result;
    try { result = await executor.execute(command); }
    catch (error) { result = { ok: false, error: error?.message || String(error) }; }
    onActivity({ ...info, state: result?.ok === false ? 'failed' : 'done', error: result?.ok === false ? String(result.error || '') : '', startedAt, finishedAt: Date.now() });
    const lease = inflight.get(command.id) || command.lease;
    inflight.delete(command.id);
    await outbox.put({ id: command.id, lease, result, createdAt: Date.now(), attempts: 0, nextAt: 0 }).catch(() => {});
    report({});
    wakeDelivery(); slotFreed();
  }

  function start(command) {
    inflight.set(command.id, command.lease);
    report({});
    const lane = SERIAL_EXEMPT.has(command.op) || !command.threadId ? null : command.threadId;
    const task = (lane && lanes.get(lane) || Promise.resolve()).then(() => run(command));
    tasks.add(task);
    if (lane) lanes.set(lane, task);
    void task.finally(() => { tasks.delete(task); if (lane && lanes.get(lane) === task) lanes.delete(lane); });
  }

  async function poll() {
    let failures = 0;
    while (!signal.aborted) {
      if (inflight.size >= concurrency) { await new Promise(resolve => { slotFreed = resolve; signal.addEventListener('abort', resolve, { once: true }); }); continue; }
      let body;
      try { body = await api('/api/local-bridge/agent/poll', { method: 'POST', body: '{}' }); failures = 0; report({ connected: true, error: '' }); }
      catch (error) {
        // A revoked token aborts the connection; still say why.
        if (signal.aborted) { if (error?.status === 401) report({ connected: false, error: describeError(error) }); break; }
        report({ connected: false, error: describeError(error) });
        await sleep(error?.status === 401 ? 10000 : backoff(failures++, 10000), signal);
        continue;
      }
      // Pausing during the poll must not start a command that arrives late.
      if (signal.aborted) break;
      const command = body?.command;
      if (!command) { await sleep(idleMs, signal); continue; }
      const queued = outbox.entries.get(command.id);
      // The relay re-leased a command whose result we already hold: deliver it, never re-run it.
      if (queued) { queued.lease = command.lease; queued.nextAt = 0; await outbox.put(queued).catch(() => {}); wakeDelivery(); continue; }
      if (inflight.has(command.id)) { inflight.set(command.id, command.lease); continue; }
      start(command);
    }
  }

  async function deliver() {
    while (!signal.aborted) {
      const now = Date.now();
      const due = [...outbox.entries.values()].filter(entry => entry.nextAt <= now).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!due) {
        const next = Math.min(...[...outbox.entries.values()].map(entry => entry.nextAt), now + 5000);
        await new Promise(resolve => { const timer = setTimeout(resolve, Math.max(50, next - now)); wakeDelivery = () => { clearTimeout(timer); resolve(); }; signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
        continue;
      }
      try {
        await api('/api/local-bridge/agent/result', { method: 'POST', body: JSON.stringify({ id: due.id, lease: due.lease, result: due.result }) });
        await outbox.remove(due.id).catch(() => {});
        report({ deliveryError: outbox.entries.size ? status.deliveryError : '' });
      } catch (error) {
        if (signal.aborted) break;
        if (deterministic(error) && !due.replaced) {
          // The server will never accept this result: tell the agent instead of retrying forever.
          due.result = { ok: false, error: 'RESULT_DELIVERY_FAILED', request_id: due.id, reason: `HTTP ${error.status}: ${String(error.message || '').slice(0, 200)}`, message: 'The computer finished this step, but its result could not be delivered. The computer is still connected. If the step changes files or runs commands, check its effect before retrying.' };
          due.replaced = true; due.nextAt = 0;
          await outbox.put(due).catch(() => {});
        } else if (deterministic(error)) {
          await outbox.remove(due.id).catch(() => {});
        } else {
          due.attempts = (due.attempts || 0) + 1;
          due.nextAt = Date.now() + backoff(due.attempts);
        }
        report({ deliveryError: describeError(error) });
      }
    }
  }

  await Promise.all([heartbeat(), poll(), deliver()]);
  // Let started steps finish (callers stop their processes); their results stay in the outbox.
  await Promise.allSettled([...tasks]);
  report({ connected: false });
}

module.exports = { runTransport, describeError, createOutbox };
