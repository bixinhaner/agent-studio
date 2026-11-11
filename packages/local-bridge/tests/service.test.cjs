const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const { createExecutor } = require('../runtime/executor.cjs');
const { createSandbox } = require('../service/sandbox.cjs');
const { buildHandbook } = require('../service/handbook.cjs');
const { createHost } = require('../service/agent-host.cjs');

const work = path.resolve(__dirname, '../../../temp/local-bridge-service-tests', randomUUID());
after(() => fs.rm(work, { recursive: true, force: true }));
const out = result => Buffer.from(result.output_base64 || '', 'base64').toString('utf8');
const MANIFEST = {
  sourceName: 'Demo', commonOperations: '# Common\n', categories: [{ id: 'project', title: 'Projects' }],
  operations: [
    { operationId: 'demo.project.get', method: 'GET', path: '/api/v1/demo/projects/{projectId}', category: 'project', title: 'Read a project', tags: ['overview'] },
    { operationId: 'demo.note.create', method: 'POST', path: '/api/v1/demo/projects/{projectId}/notes', category: 'project', title: 'Add a note', risk: 'low' }
  ]
};
async function listen(handler) {
  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {};
    try { await handler(req, res, body); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ detail: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

test('session policy: inputs are read-only for file tools, writable directories work, commands run with a clean environment', async () => {
  const root = path.join(work, 'policy'); await fs.mkdir(path.join(root, 'inputs'), { recursive: true }); await fs.mkdir(path.join(root, 'work'));
  await fs.writeFile(path.join(root, 'inputs/kpi.csv'), 'cell,drop\nA,1\n');
  process.env.SERVICE_TEST_SECRET = 'must-not-leak';
  const executor = createExecutor({ getRoots: () => [{ id: 'r', path: root, writable: ['work', 'outputs'] }], policy: createSandbox({ mode: 'none' }) });
  const call = (op, args) => executor.execute({ id: randomUUID(), rootId: 'r', threadId: 't', op, args });
  assert.equal((await call('read', { path: 'inputs/kpi.csv' })).ok, true);
  for (const [op, args] of [['write', { path: 'inputs/kpi.csv', content: 'x' }], ['edit', { path: 'inputs/kpi.csv', old_text: 'A', new_text: 'B' }], ['delete', { path: 'inputs/kpi.csv' }], ['move', { path: 'inputs/kpi.csv', destination: 'work/kpi.csv' }], ['move', { path: 'work', destination: 'inputs/w' }], ['write', { path: 'AGENTS.md', content: 'x' }], ['delete', { path: 'work' }], ['mkdir', { path: 'elsewhere' }]]) {
    assert.match((await call(op, args)).error, /READ_ONLY_LOCATION/, `${op} ${JSON.stringify(args)}`);
  }
  assert.equal((await call('write', { path: 'work/result.md', content: 'ok' })).ok, true);
  assert.equal((await call('mkdir', { path: 'outputs' })).ok, true);
  assert.equal((await call('move', { path: 'work/result.md', destination: 'outputs/result.md' })).ok, true);
  assert.equal(await fs.readFile(path.join(root, 'inputs/kpi.csv'), 'utf8'), 'cell,drop\nA,1\n');
  const env = await call('exec', { command: 'echo "secret=${SERVICE_TEST_SECRET:-none} home=$HOME dir=$SESSION_DIR"', yield_ms: 5000 });
  assert.equal(out(env).trim(), `secret=none home=${path.join(root, 'work')} dir=${root}`);
  assert.match((await call('workspace_info', {})).execution, /restricted-session/);
});

test('bubblewrap invocation exposes only the session directory, read-only except writable directories', () => {
  const sandbox = createSandbox({ mode: 'bwrap', readOnlyPaths: ['/opt/runtime'], limits: { cpuSeconds: 60 } });
  const root = path.join(work, 'bw'); require('node:fs').mkdirSync(root, { recursive: true });
  const wrapped = sandbox.wrapExec({ root: { id: 'r', path: root, writable: ['work', '../escape', '.'] }, cwd: '/etc', command: 'ls', env: { A: '1' } });
  const args = wrapped.args.join(' ');
  assert.equal(wrapped.file, '/usr/bin/bwrap');
  assert.ok(args.includes('--unshare-all') && !args.includes('--share-net') && args.includes('--clearenv'));
  assert.ok(args.includes(`--ro-bind ${root} ${root}`) && args.includes(`--bind ${path.join(root, 'work')} ${path.join(root, 'work')}`));
  assert.ok(!args.includes('escape') && !args.includes(`--bind ${root} ${root}`));
  assert.ok(args.includes(`--chdir ${root}`) && args.includes('--ro-bind-try /opt/runtime /opt/runtime') && args.endsWith('-c ulimit -t 60; ls'));
  assert.deepEqual(wrapped.env, { PATH: '/usr/bin:/bin' });
});

test('handbook: one registry yields a verifiable package, chunks, catalog and request matching', () => {
  const book = buildHandbook(MANIFEST);
  assert.equal(buildHandbook(MANIFEST).meta.handbookDigest, book.meta.handbookDigest);
  assert.notEqual(buildHandbook({ ...MANIFEST, commonOperations: '# Changed\n' }).meta.handbookDigest, book.meta.handbookDigest);
  const chunks = Array.from({ length: book.meta.totalChunks }, (_, i) => Buffer.from(book.discovery('GET', `/api/v1/agent/handbook/chunks/${i}`).data, 'base64'));
  const raw = gunzipSync(Buffer.concat(chunks)).toString('latin1');
  for (const name of ['references/manifest.json', 'references/api-index.jsonl', 'references/common-operations.md', 'references/api-docs/demo.note.create.json']) assert.ok(raw.includes(name), name);
  assert.equal(book.discovery('GET', '/api/v1/agent/handbook/manifest').handbookDigest, book.meta.handbookDigest);
  assert.throws(() => book.discovery('GET', '/api/v1/agent/handbook/chunks/9'), /out of range/);
  assert.equal(book.discovery('GET', '/api/v1/agent/catalog', { q: 'note' }).items[0].operationId, 'demo.note.create');
  assert.equal(book.discovery('GET', '/api/v1/agent/catalog/describe', { operationId: 'demo.project.get' }).risk, 'read');
  assert.deepEqual(book.match('GET', '/api/v1/demo/projects/p%201').pathParams, { projectId: 'p 1' });
  assert.equal(book.match('DELETE', '/api/v1/demo/projects/p1'), null);
  assert.equal(book.discovery('GET', '/api/v1/demo/projects/p1'), undefined);
  assert.throws(() => buildHandbook({ operations: [{ ...MANIFEST.operations[0], path: '/api/v1/agent/x' }] }), /outside/);
});

test('agent host: connects with an access key, registers a session directory, relays a turn and executes tool requests through the application', async () => {
  const dir = path.join(work, 'host'); const sessions = path.join(dir, 'sessions'); await fs.mkdir(path.join(sessions, 's1'), { recursive: true });
  await fs.writeFile(path.join(dir, 'secret'), 'local-secret\n');
  const seen = { appCalls: [], toolResults: [], chat: null, roots: [], removed: [], enroll: [], unpaired: 0 };
  const appUrl = await listen((req, res, body) => {
    if (req.headers.authorization !== 'Bearer local-secret') return json(res, 401, {});
    if (req.url === '/api/ai/capabilities') return json(res, 200, MANIFEST);
    seen.appCalls.push(body);
    if (body.operationId === 'demo.note.create') return json(res, 200, { status: 'error', error: { code: 'CONFIRMATION_REQUIRED', message: 'ask the user' } });
    return json(res, 200, { status: 'ok', output: { name: 'Project ' + body.pathParams.projectId } });
  });
  let resultsDone;
  const allResults = new Promise(resolve => { resultsDone = resolve; });
  const studioUrl = await listen(async (req, res, body) => {
    if (req.url === '/api/local-bridge/hosts/enroll') { seen.enroll.push(body); return req.headers.authorization === 'Bearer bly_key' ? json(res, 201, { connector: { id: 'c1', name: 'Demo connector' }, device_id: 'dev1', token: 'asb_device', created: !body.token }) : json(res, 401, { detail: '接入密钥无效或已撤销' }); }
    if (req.url === '/api/local-bridge/agent/unpair') { if (req.headers.authorization === 'Bearer asb_device') seen.unpaired += 1; return json(res, 200, { ok: true }); }
    if (req.url.startsWith('/api/local-bridge/agent/') && req.headers.authorization !== 'Bearer asb_device') return json(res, 401, {});
    if (req.url === '/api/local-bridge/agent/roots') { seen.roots.push(body); return json(res, 201, { root: { id: 'root1', path: body.path, label: body.label } }); }
    if (req.method === 'DELETE' && req.url === '/api/local-bridge/agent/roots/root1') { seen.removed.push('root1'); res.writeHead(204); return res.end(); }
    if (req.url === '/api/local-bridge/agent/heartbeat') return json(res, 200, { ok: true });
    if (req.url === '/api/local-bridge/agent/poll') return json(res, 200, { command: null });
    if (req.url === '/api/action-connectors/c1/tool-results') { seen.toolResults.push({ auth: req.headers.authorization, ...body }); if (seen.toolResults.length === 3) resultsDone(); return json(res, 200, { ok: true }); }
    if (req.url === '/api/action-connectors/c1/chat/stream') {
      seen.chat = { auth: req.headers.authorization, body };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const sse = event => res.write(`event: agent\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
      sse({ type: 'start', runId: body.clientRunId, conversationId: body.conversationId });
      sse({ type: 'tool_request', runId: body.clientRunId, toolCallId: 't1', title: 'GET project', input: { method: 'GET', path: '/api/v1/demo/projects/p1', operationId: 'demo.project.get' } });
      sse({ type: 'tool_request', runId: body.clientRunId, toolCallId: 't2', input: { method: 'POST', path: '/api/v1/demo/projects/p1/notes', body: { text: 'hi' } } });
      sse({ type: 'tool_request', runId: body.clientRunId, toolCallId: 't3', input: { method: 'GET', path: '/api/v1/other/secret' } });
      await allResults;
      res.write('event: agent\ndata: {"type":"delta","te'); res.write('xt":"结论"}\n\n');
      sse({ type: 'done' }); return res.end();
    }
    json(res, 404, {});
  });
  const config = { instanceId: 'inst', instanceName: 'Demo', sourceSystem: 'demo', listen: { host: '127.0.0.1', port: 0 }, secretFile: path.join(dir, 'secret'), stateDir: path.join(dir, 'state'), sessionsRoot: sessions, app: { baseUrl: appUrl, capabilitiesPath: '/api/ai/capabilities', operationsPath: '/api/ai/operations', timeoutMs: 5000 }, sandbox: { mode: 'none' } };
  const logs = [];
  const host = await createHost(config, { log: line => logs.push(line) });
  await host.start(); after(() => host.stop());
  const base = `http://127.0.0.1:${host.port()}`; const auth = { authorization: 'Bearer local-secret', 'content-type': 'application/json' };
  assert.equal((await fetch(base + '/health')).status, 401);
  // Not connected yet: the application's administrator enters Bailey's address and a key.
  assert.equal((await (await fetch(base + '/health', { headers: auth })).json()).bailey, null);
  assert.equal((await fetch(base + '/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: 'x', user: { id: 'u1' } }) })).status, 409);
  const connect = body => fetch(base + '/connection', { method: 'PUT', headers: auth, body: JSON.stringify(body) });
  assert.equal((await connect({ baseUrl: 'http://bailey.example.com', accessKey: 'bly_key' })).status, 400);
  const refused = await connect({ baseUrl: studioUrl, accessKey: 'bly_wrong' });
  assert.equal(refused.status, 401); assert.match((await refused.json()).detail, /接入密钥无效/);
  const linked = await (await connect({ baseUrl: studioUrl + '/some/path', accessKey: 'bly_key' })).json();
  assert.deepEqual(linked.bailey, { baseUrl: studioUrl, connectorId: 'c1', connectorName: 'Demo connector' });
  assert.equal(linked.device, 'dev1');
  const saved = await fs.readFile(path.join(dir, 'state', 'device.json'), 'utf8');
  assert.ok(!saved.includes('bly_key'), 'the access key is not kept');
  await assert.rejects(host.openSession({ path: dir }), /inside sessionsRoot/);
  const opened = await (await fetch(base + '/sessions', { method: 'POST', headers: auth, body: JSON.stringify({ path: path.join(sessions, 's1'), label: 'batch 1' }) })).json();
  assert.equal(opened.rootId, 'root1');
  const response = await fetch(base + '/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: '看一下项目', conversationId: 'conv1', user: { id: 'u1', name: 'Alice' }, rootId: 'root1', context: { scenario: 'overview' } }) });
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.filter(e => e.type !== 'host_tool').map(e => e.type), ['start', 'delta', 'done']);
  assert.equal(events.find(e => e.type === 'delta').text, '结论');
  assert.deepEqual(events.filter(e => e.type === 'host_tool' && e.state !== 'running').map(e => [e.toolCallId, e.state]).sort(), [['t1', 'done'], ['t2', 'failed'], ['t3', 'failed']]);
  assert.equal(seen.chat.body.conversationId, 'inst:u1:conv1');
  const sha = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  assert.deepEqual(seen.chat.body.context.localComputer, { rootId: 'root1', proof: sha(`connector-root-v1:${sha('asb_device')}:root1:inst:u1:conv1`) });
  assert.equal(seen.chat.body.context.scenario, 'overview');
  assert.equal(seen.chat.body.context.externalIdentity.externalUserId, 'inst:u1');
  assert.match(seen.chat.body.context.externalIdentity.metadata.apiHandbook.handbookDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(seen.chat).includes('local-secret') && !JSON.stringify(seen.chat).includes('asb_device'));
  assert.ok(seen.toolResults.every(r => r.auth === seen.chat.auth));
  const byId = Object.fromEntries(seen.toolResults.map(r => [r.toolCallId, r]));
  assert.deepEqual(byId.t1.output, { name: 'Project p1' });
  assert.equal(byId.t2.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(byId.t3.error.code, 'OPERATION_NOT_FOUND');
  assert.equal(seen.appCalls.length, 2);
  assert.deepEqual({ ...seen.appCalls[0], runId: undefined }, { operationId: 'demo.project.get', risk: 'read', pathParams: { projectId: 'p1' }, query: {}, body: null, reason: '', user: { id: 'u1', name: 'Alice' }, conversationId: 'conv1', runId: undefined, toolCallId: 't1', rootId: 'root1' });
  const bad = await (await fetch(base + '/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: 'x', user: { id: 'u1' }, rootId: 'someone-elses' }) })).text();
  assert.match(bad, /unknown session directory/);
  assert.equal((await fetch(base + '/sessions/root1', { method: 'DELETE', headers: auth })).status, 200);
  assert.deepEqual(seen.removed, ['root1']);
  assert.equal((await (await fetch(base + '/health', { headers: auth })).json()).sessions, 0);
  // Reconnecting presents the current device token so Bailey keeps the same device.
  await connect({ baseUrl: studioUrl, accessKey: 'bly_key' });
  assert.equal(seen.enroll.at(-1).token, 'asb_device');
  const left = await (await fetch(base + '/connection', { method: 'DELETE', headers: auth })).json();
  assert.equal(left.bailey, null); assert.equal(seen.unpaired, 1);
  assert.ok(!(await fs.readFile(path.join(dir, 'state', 'device.json'), 'utf8')).includes('asb_device'));
});
