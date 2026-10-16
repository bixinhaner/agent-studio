const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const LIMIT = 2 * 1024 * 1024;
// Command output is kept as raw bytes; the server detects each line's encoding (UTF-8, GBK, UTF-16).
const OUTPUT_LIMIT = 256 * 1024;
const INSTRUCTIONS_LIMIT = 64 * 1024;

/**
 * How a Shell command is started. On Windows the whole command is quoted for `cmd /s /c`
 * and passed verbatim: Node's default argument escaping (\") is not understood by cmd, which
 * broke commands such as python -c "...".
 */
function shellInvocation(command, platform = process.platform, env = process.env) {
  if (platform === 'win32') return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true };
  return { file: env.SHELL || '/bin/sh', args: ['-lc', command], windowsVerbatimArguments: false };
}

/**
 * Length of `bytes` without a trailing, still-incomplete UTF-8 sequence that more output may
 * complete. Output in a legacy code page (GBK) is not held back: it is not UTF-8 to begin with.
 */
function completeUtf8Length(bytes) {
  for (let back = 1; back <= Math.min(3, bytes.length); back++) {
    const byte = bytes[bytes.length - back];
    if ((byte & 0xc0) === 0x80) continue;
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    if (need <= back) return bytes.length;
    const cut = bytes.length - back;
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, cut)); return cut; } catch { return bytes.length; }
  }
  return bytes.length;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A trusted local-user executor. Roots select file-tool scope and Shell cwd, not an OS sandbox. */
function createExecutor({ getRoots, journalDir, chooseRoot, openPath, version }) {
  const active = new Map();
  const processes = new Map();
  async function scoped(root, input = '.', creating = false, followLeaf = true) {
    const base = await fs.realpath(root.path);
    const target = path.resolve(base, input);
    const inside = value => value === base || value.startsWith(base + path.sep);
    if (!inside(target)) throw new Error('FILE_PATH_OUTSIDE_SELECTED_FOLDER');
    if (!followLeaf && target !== base) { const leaf = path.join(await fs.realpath(path.dirname(target)), path.basename(target)); if (!inside(leaf)) throw new Error('FILE_PATH_OUTSIDE_SELECTED_FOLDER'); return leaf; }
    let canonical;
    try { canonical = await fs.realpath(target); }
    catch (error) {
      if (!creating || error.code !== 'ENOENT') throw error;
      canonical = path.join(await fs.realpath(path.dirname(target)), path.basename(target));
    }
    if (!inside(canonical)) throw new Error('FILE_PATH_OUTSIDE_SELECTED_FOLDER');
    return canonical;
  }
  function snapshot(p, cursor = 0) {
    const start = Math.max(Number(cursor) || 0, p.offset);
    let bytes = p.output.subarray(start - p.offset);
    if (p.running) bytes = bytes.subarray(0, completeUtf8Length(bytes));
    return { process_id: p.id, running: p.running, exit_code: p.exitCode, output_base64: bytes.toString('base64'), cursor: start + bytes.length, truncated: start > (Number(cursor) || 0), timed_out: p.timedOut };
  }
  function stop(p) {
    if (!p.running) return;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.child.pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(-p.child.pid, 'SIGTERM'); } catch {} setTimeout(() => { try { process.kill(-p.child.pid, 'SIGKILL'); } catch {} }, 1000).unref(); }
  }
  async function perform(command) {
    const a = command.args || {};
    const session = command.threadId;
    if (command.op === 'choose_folder') { if (!chooseRoot) throw new Error('DESKTOP_REQUIRED'); return chooseRoot(a.connectionId); }
    if (command.op === 'cancel_task') { for (const p of processes.values()) if (p.session === session) stop(p); return { stopped: true }; }
    const root = (await getRoots()).find(r => r.id === command.rootId);
    if (!root) throw new Error('FOLDER_NOT_SELECTED_ON_THIS_COMPUTER');
    if (command.op === 'process') {
      const p = processes.get(a.process_id);
      if (!p || p.session !== session || p.rootId !== root.id) throw new Error('PROCESS_NOT_FOUND_OR_APP_RESTARTED');
      if (a.cancel) stop(p);
      if (typeof a.input === 'string' && p.running) p.child.stdin.write(a.input);
      if (a.close_stdin && p.running) p.child.stdin.end();
      const until = Date.now() + Math.min(Math.max(Number(a.wait_ms) || 0, 0), 10000);
      while (p.running && Date.now() < until) await pause(50);
      return snapshot(p, a.cursor);
    }
    if (command.op === 'exec') {
      if (typeof a.command !== 'string' || !a.command.trim() || a.command.length > 100000) throw new Error('COMMAND_REQUIRED');
      const cwd = a.cwd ? path.resolve(root.path, a.cwd) : root.path;
      const shell = shellInvocation(a.command);
      const child = spawn(shell.file, shell.args, { cwd, env: { ...process.env, ...(a.env || {}) }, detached: process.platform !== 'win32', windowsHide: true, windowsVerbatimArguments: shell.windowsVerbatimArguments, stdio: ['pipe', 'pipe', 'pipe'] });
      const p = { id: randomUUID(), child, session, rootId: root.id, running: true, output: Buffer.alloc(0), offset: 0, exitCode: null, timedOut: false };
      processes.set(p.id, p);
      const append = chunk => { p.output = Buffer.concat([p.output, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]); if (p.output.length > OUTPUT_LIMIT) { const n = p.output.length - OUTPUT_LIMIT; p.output = p.output.subarray(n); p.offset += n; } };
      child.stdout.on('data', append); child.stderr.on('data', append);
      const timer = setTimeout(() => { p.timedOut = true; stop(p); }, Math.min(Math.max(Number(a.timeout_ms) || 120000, 1000), 1800000));
      const finish = code => { p.running = false; p.exitCode = code; clearTimeout(timer); setTimeout(() => processes.delete(p.id), 3600000).unref(); };
      child.on('error', error => { append(error.message); finish(-1); }); child.on('close', finish);
      const until = Date.now() + Math.min(Math.max(Number(a.yield_ms) || 1000, 100), 10000);
      while (p.running && Date.now() < until) await pause(50);
      return snapshot(p);
    }
    const target = await scoped(root, a.path, ['write', 'mkdir', 'move'].includes(command.op), !['delete', 'move'].includes(command.op));
    switch (command.op) {
      case 'workspace_info': {
        let instructions = '';
        try { instructions = (await fs.readFile(await scoped(root, 'AGENTS.md'))).subarray(0, INSTRUCTIONS_LIMIT).toString('base64'); } catch {}
        return { directory: root.path, platform: process.platform, home: os.homedir(), shell: process.env.SHELL || process.env.ComSpec, execution: 'trusted-local-user', instructions_base64: instructions, ...(version ? { client_version: version } : {}) };
      }
      case 'list': return { path: target, entries: (await fs.readdir(target, { withFileTypes: true })).slice(0, 2000).map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'symlink' : 'file' })) };
      case 'read': {
        const stat = await fs.stat(target);
        if (!stat.isFile()) throw new Error('NOT_A_FILE');
        const ranged = a.offset !== undefined || a.length !== undefined;
        if (!ranged && stat.size > LIMIT) throw new Error('FILE_TOO_LARGE_USE_OFFSET_AND_LENGTH');
        const offset = Math.min(Math.max(Math.floor(Number(a.offset) || 0), 0), stat.size);
        const length = Math.min(Math.max(Math.floor(Number(a.length ?? LIMIT) || 0), 0), LIMIT, stat.size - offset);
        let bytes;
        if (ranged) { const handle = await fs.open(target, 'r'); try { bytes = Buffer.alloc(length); const { bytesRead } = await handle.read(bytes, 0, length, offset); bytes = bytes.subarray(0, bytesRead); } finally { await handle.close(); } }
        else bytes = await fs.readFile(target);
        return { path: target, content: bytes.toString(a.encoding === 'base64' ? 'base64' : 'utf8'), encoding: a.encoding === 'base64' ? 'base64' : 'utf8', size: stat.size, ...(ranged ? { offset, length: bytes.length, eof: offset + bytes.length >= stat.size } : {}) };
      }
      case 'write': case 'edit': {
        let content = a.content;
        if (command.op === 'edit') {
          const source = await fs.readFile(target, 'utf8');
          if (typeof a.old_text !== 'string' || !a.old_text || typeof a.new_text !== 'string') throw new Error('EXACT_EDIT_TEXT_REQUIRED');
          if (!source.includes(a.old_text) || (!a.replace_all && source.indexOf(a.old_text) !== source.lastIndexOf(a.old_text))) throw new Error('EDIT_MATCH_MUST_BE_UNIQUE');
          content = a.replace_all ? source.split(a.old_text).join(a.new_text) : source.replace(a.old_text, () => a.new_text);
        }
        if (typeof content !== 'string' || Buffer.byteLength(content, a.encoding === 'base64' ? 'base64' : 'utf8') > LIMIT) throw new Error('CONTENT_TOO_LARGE');
        // Server-side edits read first; refuse to overwrite a file that changed since that read.
        if (typeof a.expected_sha256 === 'string') {
          const current = await fs.readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (!current || createHash('sha256').update(current).digest('hex') !== a.expected_sha256) throw new Error('FILE_CHANGED_SINCE_READ');
        }
        const temp = path.join(path.dirname(target), `.agent-studio-${randomUUID()}.tmp`);
        const mode = await fs.stat(target).then(s => s.mode).catch(() => 0o644);
        try { await fs.writeFile(temp, content, { encoding: a.encoding === 'base64' ? 'base64' : 'utf8', mode, flag: 'wx' }); await fs.rename(temp, target); }
        finally { await fs.rm(temp, { force: true }); }
        return { path: target, written: true };
      }
      case 'mkdir': await fs.mkdir(target, { recursive: false }); return { path: target, created: true };
      case 'move': { const destination = await scoped(root, a.destination, true, false); await fs.rename(target, destination); return { path: destination }; }
      case 'delete': if (target === await fs.realpath(root.path)) throw new Error('CANNOT_DELETE_WORKSPACE_ROOT'); await fs.rm(target, { recursive: Boolean(a.recursive), force: false }); return { deleted: true };
      case 'open': if (!openPath) throw new Error('DESKTOP_REQUIRED'); await openPath(target); return { opened: true, path: target };
      default: throw new Error('UNSUPPORTED_LOCAL_OPERATION');
    }
  }
  async function execute(command) {
    if (!/^[a-zA-Z0-9_-]{1,180}$/.test(command.id || '')) throw new Error('INVALID_REQUEST_ID');
    if (active.has(command.id)) return active.get(command.id);
    const work = (async () => {
      const journal = journalDir && path.join(journalDir, `${command.id}.json`);
      if (journal) {
        await fs.mkdir(journalDir, { recursive: true, mode: 0o700 });
        try { const previous = JSON.parse(await fs.readFile(journal, 'utf8')); return previous.result || { ok: false, error: 'EXECUTION_OUTCOME_UNKNOWN_AFTER_RESTART', request_id: command.id }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
        await fs.writeFile(journal, JSON.stringify({ started: Date.now() }), { mode: 0o600, flag: 'wx' });
      }
      let result;
      try { result = { ok: true, ...await perform(command) }; }
      catch (error) { result = { ok: false, error: error.message || String(error) }; }
      if (journal) { const temp = journal + '.tmp'; await fs.writeFile(temp, JSON.stringify({ result, completed: Date.now() }), { mode: 0o600 }); await fs.rename(temp, journal); }
      return result;
    })();
    active.set(command.id, work);
    // Keep a bounded in-memory dedupe cache; the request journal survives restarts.
    work.finally(() => { if (active.size > 1000) active.delete(active.keys().next().value); }).catch(() => {});
    return work;
  }
  return { execute, stopAll: () => { for (const p of processes.values()) stop(p); }, runningProcesses: () => [...processes.values()].filter(p => p.running).length };
}
module.exports = { createExecutor, shellInvocation, completeUtf8Length };
