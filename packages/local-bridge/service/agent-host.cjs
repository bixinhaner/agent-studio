#!/usr/bin/env node
'use strict';
/**
 * Agent Host: the one process a business system runs beside itself to use Agent Studio agents.
 *
 *   business system  <── 127.0.0.1 ──>  agent-host  <── HTTPS (outbound only) ──>  Agent Studio
 *
 * It joins two existing Agent Studio channels so the business system implements neither:
 * - Action Connector: conversations, and the agent's calls to the system's business operations;
 * - Local Bridge (service device): the agent works on files in a session directory on this host,
 *   inside a sandbox, so data is processed where it lives and only conclusions travel.
 *
 * The business system provides two HTTP endpoints (capability manifest, run an operation) and
 * calls three here (open a session directory, chat, close the directory). See README-agent-host.md.
 */
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, timingSafeEqual, createHash } = require('node:crypto');
const { createExecutor } = require('../runtime/executor.cjs');
const { runTransport } = require('../runtime/transport.cjs');
const { createSandbox } = require('./sandbox.cjs');
const { buildHandbook } = require('./handbook.cjs');

const VERSION = '0.4.0';
const readSecret = async file => (await fs.readFile(file, 'utf8')).trim();
const sameSecret = (a, b) => { const x = createHash('sha256').update(String(a)).digest(); const y = createHash('sha256').update(String(b)).digest(); return timingSafeEqual(x, y); };

async function loadConfig(file) {
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  const need = (value, name) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`config: ${name} is required`); return value.trim(); };
  const studio = new URL(need(config.studio?.baseUrl, 'studio.baseUrl'));
  if (studio.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(studio.hostname)) throw new Error('config: studio.baseUrl must be HTTPS');
  return {
    instanceId: need(config.instanceId, 'instanceId'),
    instanceName: config.instanceName || config.instanceId,
    sourceSystem: config.sourceSystem || 'business-system',
    studio: { baseUrl: studio.origin, connectorId: need(config.studio.connectorId, 'studio.connectorId') },
    listen: { host: config.listen?.host || '127.0.0.1', port: Number(config.listen?.port) || 9191 },
    secretFile: need(config.secretFile, 'secretFile'),
    stateDir: need(config.stateDir, 'stateDir'),
    sessionsRoot: need(config.sessionsRoot, 'sessionsRoot'),
    app: { baseUrl: need(config.app?.baseUrl, 'app.baseUrl').replace(/\/$/, ''), capabilitiesPath: config.app.capabilitiesPath || '/api/ai/capabilities', operationsPath: config.app.operationsPath || '/api/ai/operations', timeoutMs: Number(config.app.timeoutMs) || 110000 },
    sandbox: config.sandbox || {}
  };
}

async function createHost(config, { fetchImpl = fetch, log = console.log } = {}) {
  await fs.mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  const secret = await readSecret(config.secretFile);
  const statePath = path.join(config.stateDir, 'device.json');
  let state = { token: '', deviceId: '', roots: [] };
  try { state = { ...state, ...JSON.parse(await fs.readFile(statePath, 'utf8')) }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const save = async () => { const temp = statePath + '.tmp'; await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600 }); await fs.rename(temp, statePath); };
  const controller = new AbortController();
  const sessionsRoot = await fs.realpath(config.sessionsRoot);
  const status = { connected: false, error: 'starting', handbook: '' };
  const connectorUrl = `${config.studio.baseUrl}/api/action-connectors/${encodeURIComponent(config.studio.connectorId)}`;

  // ---- Local Bridge service device -------------------------------------------------------
  async function bridge(endpoint, init = {}) {
    const response = await fetchImpl(config.studio.baseUrl + endpoint, { ...init, headers: { 'content-type': 'application/json', 'x-local-bridge-version': VERSION, authorization: `Bearer ${state.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
    const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.detail || `Agent Studio answered ${response.status}`), { status: response.status });
    return body;
  }
  /** One-time registration with the connector's service credentials; they are not kept on this host. */
  async function pair(serviceToken) {
    const response = await fetchImpl(`${config.studio.baseUrl}/api/integrations/action-connectors/${encodeURIComponent(config.studio.connectorId)}/local-bridge/devices`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify({ name: `${config.instanceName} (${os.hostname()})`.slice(0, 120), platform: 'linux-service', ...(state.token ? { token: state.token } : {}) })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `pairing failed (${response.status})`);
    if (state.deviceId !== body.device_id) state.roots = [];
    state.token = body.token; state.deviceId = body.device_id; await save();
    return body.device_id;
  }
  const sandbox = createSandbox(config.sandbox);
  const executor = createExecutor({ getRoots: () => state.roots, journalDir: path.join(config.stateDir, 'requests'), version: VERSION, policy: sandbox });

  async function openSession({ path: directory, label, writable }) {
    const real = await fs.realpath(String(directory));
    if (real === sessionsRoot || !real.startsWith(sessionsRoot + path.sep)) throw Object.assign(new Error('session directory must be inside sessionsRoot'), { status: 400 });
    const { root } = await bridge('/api/local-bridge/agent/roots', { method: 'POST', body: JSON.stringify({ path: real, label: String(label || path.basename(real)).slice(0, 120) }) });
    state.roots = [...state.roots.filter(item => item.id !== root.id), { id: root.id, path: real, writable: Array.isArray(writable) ? writable.map(String) : ['work', 'outputs'] }];
    await save();
    return { rootId: root.id, path: real };
  }
  async function closeSession(rootId) {
    await bridge(`/api/local-bridge/agent/roots/${encodeURIComponent(rootId)}`, { method: 'DELETE' }).catch(error => { if (error.status !== 404) throw error; });
    state.roots = state.roots.filter(item => item.id !== rootId); await save();
  }

  // ---- Business operations ----------------------------------------------------------------
  let handbook = null; let handbookAt = 0;
  async function app(pathname, init = {}) {
    const response = await fetchImpl(config.app.baseUrl + pathname, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(config.app.timeoutMs) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok && !body.error) throw new Error(`application answered ${response.status}`);
    return body;
  }
  /** The registry is re-read at most every 30 s, so a changed operation publishes a new digest by itself. */
  async function currentHandbook() {
    if (handbook && Date.now() - handbookAt < 30000) return handbook;
    try { handbook = buildHandbook(await app(config.app.capabilitiesPath)); handbookAt = Date.now(); status.handbook = handbook.meta.handbookDigest; }
    catch (error) { status.handbook = `unavailable: ${error.message}`; if (!handbook) throw error; }
    return handbook;
  }
  async function runTool(input, turn) {
    const book = await currentHandbook();
    const method = String(input.method || '').toUpperCase(); const requestPath = String(input.path || '');
    const found = book.discovery(method, requestPath, input.query || {});
    if (found !== undefined) return found;
    const matched = book.match(method, requestPath);
    if (!matched) throw Object.assign(new Error(`${method} ${requestPath} is not a published operation`), { code: 'OPERATION_NOT_FOUND' });
    if (input.operationId && input.operationId !== matched.operation.operationId) throw Object.assign(new Error(`path belongs to ${matched.operation.operationId}, not ${input.operationId}`), { code: 'OPERATION_MISMATCH' });
    const answer = await app(config.app.operationsPath, { method: 'POST', body: JSON.stringify({
      operationId: matched.operation.operationId, risk: matched.operation.risk, pathParams: matched.pathParams, query: input.query || {}, body: input.body ?? null, reason: input.reason || '',
      user: turn.user, conversationId: turn.conversationId, runId: turn.runId, toolCallId: turn.toolCallId, rootId: turn.rootId || null
    }) });
    if (answer.status === 'ok') return answer.output ?? {};
    throw Object.assign(new Error(answer.error?.message || 'operation failed'), { code: answer.error?.code || 'OPERATION_FAILED', retryable: Boolean(answer.error?.retryable), details: answer.error?.details });
  }

  // ---- Conversations ------------------------------------------------------------------------
  async function postToolResult(authorization, result) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetchImpl(`${connectorUrl}/tool-results`, { method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: JSON.stringify(result), signal: AbortSignal.timeout(30000) });
        if (response.ok || (response.status >= 400 && response.status < 500)) return;
      } catch {}
      if (attempt >= 4) return;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  /**
   * Runs one turn. `emit` receives every Agent Studio event; tool requests are executed here and
   * their outcome is appended as { type: 'host_tool', ... } so the caller can show progress.
   */
  async function chat(request, emit, signal) {
    const user = request.user || {};
    if (typeof user.id !== 'string' || !user.id) throw Object.assign(new Error('user.id is required'), { status: 400 });
    if (typeof request.message !== 'string' || !request.message.trim()) throw Object.assign(new Error('message is required'), { status: 400 });
    if (request.rootId && !state.roots.some(root => root.id === request.rootId)) throw Object.assign(new Error('unknown session directory'), { status: 400 });
    const book = await currentHandbook();
    const externalUserId = `${config.instanceId}:${user.id}`;
    const conversationId = `${externalUserId}:${request.conversationId || randomUUID()}`;
    const runId = request.clientRunId || randomUUID();
    // The connector binds tool results to the bearer that opened the stream.
    const authorization = `Bearer ${createHash('sha256').update(`${secret}:${runId}`).digest('base64url')}`;
    const body = {
      message: request.message, conversationId, clientRunId: runId, mode: 'execute', locale: request.locale || 'zh-CN', timezone: request.timezone || 'Asia/Shanghai', attachments: [],
      context: {
        ...(request.context || {}),
        ...(request.rootId !== undefined ? { localComputer: { rootId: request.rootId } } : {}),
        externalIdentity: {
          externalUserId, externalUserName: user.name || user.id, roles: user.roles || [], scopes: user.scopes || [],
          metadata: { sourceSystem: config.sourceSystem, instanceId: config.instanceId, instanceName: config.instanceName, softwareVersion: request.softwareVersion || '', apiHandbook: book.meta }
        }
      }
    };
    const response = await fetchImpl(`${connectorUrl}/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization }, body: JSON.stringify(body), signal });
    if (!response.ok || !response.body) throw Object.assign(new Error(`Agent Studio answered ${response.status}`), { status: 502 });
    const pending = new Set();
    const handle = event => {
      if (event.type === 'ping') return;
      if (event.type !== 'tool_request') return emit(event);
      emit({ type: 'host_tool', state: 'running', toolCallId: event.toolCallId, title: event.title || '' });
      const task = runTool(event.input || {}, { user: { id: user.id, name: user.name || '' }, conversationId: request.conversationId || conversationId, runId: event.runId || runId, toolCallId: event.toolCallId, rootId: request.rootId })
        .then(output => ({ status: 'ok', output }), error => ({ status: 'error', error: { code: error.code || 'HOST_ERROR', message: error.message, retryable: Boolean(error.retryable), ...(error.details ? { details: error.details } : {}) } }))
        .then(async result => {
          await postToolResult(authorization, { runId: event.runId || runId, toolCallId: event.toolCallId, ...result });
          emit({ type: 'host_tool', state: result.status === 'ok' ? 'done' : 'failed', toolCallId: event.toolCallId, title: event.title || '', ...(result.error ? { error: result.error } : {}) });
        });
      pending.add(task); void task.finally(() => pending.delete(task));
    };
    const decoder = new TextDecoder(); let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
      for (let end; (end = buffer.indexOf('\n\n')) >= 0;) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let event; try { event = JSON.parse(data); } catch { continue; }
        if (event && typeof event === 'object' && typeof event.type === 'string') handle(event);
      }
    }
    await Promise.allSettled([...pending]);
  }

  // ---- Local API for the business system ----------------------------------------------------
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://local');
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || '';
      if (!sameSecret(bearer, secret)) return send(401, { detail: 'unauthorized' });
      const readBody = async () => { const parts = []; let size = 0; for await (const part of req) { size += part.length; if (size > 1024 * 1024) throw Object.assign(new Error('request too large'), { status: 413 }); parts.push(part); } return parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}; };
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { version: VERSION, device: state.deviceId || null, paired: Boolean(state.token), ...status, sessions: state.roots.length, sandbox: sandbox.execution });
      if (req.method === 'POST' && url.pathname === '/sessions') return send(201, await openSession(await readBody()));
      const session = /^\/sessions\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (req.method === 'DELETE' && session) { await closeSession(session[1]); return send(200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/chat') {
        const request = await readBody();
        const abort = new AbortController(); res.on('close', () => { if (!res.writableEnded) abort.abort(); });
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
        const emit = event => { if (!res.writableEnded) res.write(JSON.stringify(event) + '\n'); };
        const beat = setInterval(() => emit({ type: 'ping' }), 15000);
        try { await chat(request, emit, abort.signal); }
        catch (error) { if (!abort.signal.aborted) emit({ type: 'error', error: { code: 'HOST_ERROR', message: error.message, retryable: true } }); }
        finally { clearInterval(beat); res.end(); }
        return;
      }
      send(404, { detail: 'not found' });
    } catch (error) {
      if (!res.headersSent) send(error.status || 500, { detail: error.message }); else res.end();
    }
  });

  async function start() {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.listen.port, config.listen.host, resolve); });
    log(`agent-host ${VERSION} listening on ${config.listen.host}:${server.address().port}; ${sandbox.execution}`);
    if (!state.token) { status.error = 'not paired: run `agent-host pair`'; log(status.error); return; }
    // Folders registered before a restart stay valid; ones whose directory is gone are withdrawn.
    for (const root of [...state.roots]) if (!await fs.stat(root.path).catch(() => null)) await closeSession(root.id).catch(() => {});
    void runTransport({ api: bridge, executor, signal: controller.signal, outboxDir: path.join(config.stateDir, 'outbox'), onStatus: next => {
      const text = next.connected ? '' : next.error || 'offline';
      if (status.connected !== next.connected || status.error !== text) log(next.connected ? 'connected to Agent Studio' : `Agent Studio: ${text}`);
      status.connected = next.connected; status.error = text;
    } }).catch(error => { status.connected = false; status.error = error.message; });
  }
  async function stop() { controller.abort(); executor.stopAll(); await new Promise(resolve => server.close(resolve)); }
  return { start, stop, pair, chat, openSession, closeSession, runTool, port: () => server.address()?.port, status, state: () => state };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith('--') ? args.shift() : 'run';
  const at = args.indexOf('--config');
  if (at < 0 || !args[at + 1]) throw new Error('usage: agent-host [run|pair] --config /path/to/agent-host.json');
  const config = await loadConfig(args[at + 1]);
  const host = await createHost(config);
  if (command === 'pair') {
    // The service token is read from the environment for this one call and never written to disk.
    const token = process.env.AGENT_STUDIO_SERVICE_TOKEN;
    if (!token) throw new Error('set AGENT_STUDIO_SERVICE_TOKEN for pairing');
    console.log(`paired as device ${await host.pair(token)}`);
    return;
  }
  if (command !== 'run') throw new Error(`unknown command ${command}`);
  await host.start();
  const stop = () => { void host.stop().then(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createHost, loadConfig, VERSION };
