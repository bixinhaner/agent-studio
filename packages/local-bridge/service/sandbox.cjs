'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Policy for a session directory offered to the agent by a business system's host.
 *
 * The directory is read-only except for the sub-directories listed in `writable`. File tools are
 * checked by path; commands run inside bubblewrap, where the rest of the host does not exist:
 * only system runtimes (read-only), the session directory and a private /tmp are visible, and the
 * network is off unless the host turns it on.
 */
const SYSTEM_PATHS = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc/alternatives', '/etc/ssl', '/etc/pki', '/etc/ca-certificates', '/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/localtime', '/etc/passwd', '/etc/group', '/etc/nsswitch.conf', '/etc/hosts', '/etc/resolv.conf'];

const inside = (base, value) => value === base || value.startsWith(base + path.sep);

function writableDirs(root) {
  return (root.writable || []).map(item => path.resolve(root.path, item)).filter(dir => dir !== root.path && inside(root.path, dir));
}

function authorize({ op, root, target, destination }) {
  const dirs = writableDirs(root);
  const allowed = value => dirs.some(dir => inside(dir, value) && (value !== dir || op === 'mkdir'));
  for (const value of [target, destination]) {
    if (value !== undefined && !allowed(value)) throw new Error(`READ_ONLY_LOCATION: only ${(root.writable || []).join(', ') || 'no directory'} can be changed in this session`);
  }
}

/**
 * @param {object} options
 * @param {'bwrap'|'none'} options.mode  'none' is for development on machines without bubblewrap.
 * @param {string} [options.bwrap]       path of the bubblewrap binary
 * @param {string[]} [options.readOnlyPaths]  extra host paths visible read-only (language runtimes)
 * @param {boolean} [options.network]
 * @param {Record<string,string>} [options.env]  environment of every command
 * @param {{cpuSeconds?:number, fileSizeMb?:number, processes?:number, openFiles?:number}} [options.limits]
 */
function createSandbox(options = {}) {
  const mode = options.mode || 'bwrap';
  const bwrap = options.bwrap || '/usr/bin/bwrap';
  const shell = ['/bin/bash', '/usr/bin/bash'].find(file => fs.existsSync(file)) || '/bin/sh';
  const limits = options.limits || {};
  const prelude = [
    limits.cpuSeconds ? `ulimit -t ${Math.floor(limits.cpuSeconds)}` : '',
    limits.fileSizeMb ? `ulimit -f ${Math.floor(limits.fileSizeMb * 1024)}` : '',
    limits.processes ? `ulimit -u ${Math.floor(limits.processes)}` : '',
    limits.openFiles ? `ulimit -n ${Math.floor(limits.openFiles)}` : ''
  ].filter(Boolean).join('; ');

  function wrapExec({ root, cwd, command, env }) {
    const dirs = writableDirs(root);
    const home = dirs[0] || root.path;
    const workdir = inside(root.path, cwd) ? cwd : root.path;
    const childEnv = {
      PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TMPDIR: '/tmp', PYTHONDONTWRITEBYTECODE: '1',
      ...(options.env || {}), ...env, HOME: home, SESSION_DIR: root.path
    };
    const script = prelude ? `${prelude}; ${command}` : command;
    if (mode === 'none') return { file: shell, args: ['-c', script], env: childEnv, cwd: workdir };
    const args = ['--unshare-all', ...(options.network ? ['--share-net'] : []), '--die-with-parent', '--new-session', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run'];
    for (const item of [...SYSTEM_PATHS, ...(options.readOnlyPaths || [])]) args.push('--ro-bind-try', item, item);
    args.push('--ro-bind', root.path, root.path);
    for (const dir of dirs) { fs.mkdirSync(dir, { recursive: true }); args.push('--bind', dir, dir); }
    args.push('--chdir', workdir, '--clearenv');
    for (const [key, value] of Object.entries(childEnv)) args.push('--setenv', key, String(value));
    args.push(shell, '-c', script);
    return { file: bwrap, args, env: { PATH: '/usr/bin:/bin' }, cwd: root.path };
  }

  return { authorize, wrapExec, execution: mode === 'bwrap' ? `sandboxed-session (bubblewrap; network ${options.network ? 'on' : 'off'}; read-only except writable directories)` : 'restricted-session (no OS sandbox)' };
}

module.exports = { createSandbox, authorize, writableDirs };
