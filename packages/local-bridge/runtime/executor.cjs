const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const LIMIT = 2 * 1024 * 1024;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A trusted local-user executor. Roots select file-tool scope and Shell cwd, not an OS sandbox. */
function createExecutor({ getRoots, journalDir, chooseRoot, openPath }) {
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
    return { process_id: p.id, running: p.running, exit_code: p.exitCode, output: p.output.slice(start - p.offset), cursor: p.offset + p.output.length, truncated: start > (Number(cursor) || 0), timed_out: p.timedOut };
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
      const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/sh';
      const args = process.platform === 'win32' ? ['/d', '/s', '/c', a.command] : ['-lc', a.command];
      const child = spawn(shell, args, { cwd, env: { ...process.env, ...(a.env || {}) }, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const p = { id: randomUUID(), child, session, rootId: root.id, running: true, output: '', offset: 0, exitCode: null, timedOut: false };
      processes.set(p.id, p);
      const append = chunk => { p.output += chunk.toString(); if (p.output.length > 200000) { const n = p.output.length - 200000; p.output = p.output.slice(n); p.offset += n; } };
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
        try { instructions = (await fs.readFile(await scoped(root, 'AGENTS.md'), 'utf8')).slice(0, 24000); } catch {}
        return { directory: root.path, platform: process.platform, home: os.homedir(), shell: process.env.SHELL || process.env.ComSpec, execution: 'trusted-local-user', instructions };
      }
      case 'list': return { path: target, entries: (await fs.readdir(target, { withFileTypes: true })).slice(0, 2000).map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'symlink' : 'file' })) };
      case 'read': {
        const stat = await fs.stat(target); if (!stat.isFile() || stat.size > LIMIT) throw new Error('FILE_TOO_LARGE_USE_SHELL_OR_PARTIAL_READ');
        const bytes = await fs.readFile(target);
        return { path: target, content: bytes.toString(a.encoding === 'base64' ? 'base64' : 'utf8'), encoding: a.encoding === 'base64' ? 'base64' : 'utf8' };
      }
      case 'write': case 'edit': {
        let content = a.content;
        if (command.op === 'edit') {
          const source = await fs.readFile(target, 'utf8');
          if (typeof a.old_text !== 'string' || !a.old_text || typeof a.new_text !== 'string') throw new Error('EXACT_EDIT_TEXT_REQUIRED');
          if (!source.includes(a.old_text) || (!a.replace_all && source.indexOf(a.old_text) !== source.lastIndexOf(a.old_text))) throw new Error('EDIT_MATCH_MUST_BE_UNIQUE');
          content = a.replace_all ? source.split(a.old_text).join(a.new_text) : source.replace(a.old_text, () => a.new_text);
        }
        if (typeof content !== 'string' || Buffer.byteLength(content) > LIMIT) throw new Error('CONTENT_TOO_LARGE');
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
  return { execute, stopAll: () => { for (const p of processes.values()) stop(p); } };
}
module.exports = { createExecutor };
