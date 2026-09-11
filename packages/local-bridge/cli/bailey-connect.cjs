#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createExecutor } = require('../runtime/executor.cjs');
const { runTransport } = require('../runtime/transport.cjs');
const VERSION = '0.2.3';
const DEFAULT_SERVER = 'https://bailey.baicells.com';

function parseArgs(args) {
  const options = { server: DEFAULT_SERVER };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--help', '-h', '--version'].includes(arg)) options[arg === '--version' ? 'version' : 'help'] = true;
    else if (['--code', '--server'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) options[arg.slice(2)] = args[++i];
    else throw new Error(`未知参数 ${arg}。运行 bailey-connect --help 查看用法。`);
  }
  const url = new URL(options.server);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('服务地址必须是 HTTPS 站点地址。');
  options.server = url.origin;
  if (options.code && !/^[a-fA-F0-9]{8,10}$/.test(options.code)) throw new Error('配对码格式不正确，请重新复制 Portal 中的命令。');
  return options;
}
async function acquireLock(filename) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await fs.writeFile(filename, String(process.pid), { flag: 'wx', mode: 0o600 }); return async () => { if (await fs.readFile(filename, 'utf8').catch(() => '') === String(process.pid)) await fs.rm(filename, { force: true }); }; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await fs.readFile(filename, 'utf8').catch(() => ''));
      // An empty lock may belong to a process that has just created it.
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('连接正在启动；请稍后重试。');
      try { process.kill(pid, 0); }
      catch (probe) { if (probe.code === 'ESRCH') { await fs.rm(filename, { force: true }); continue; } }
      throw new Error('已有连接正在运行。请在原终端按 Ctrl+C 结束后，再从此目录运行命令。');
    }
  }
  throw new Error('无法启动连接，请稍后重试。');
}
async function connect(options) {
  const directory = await fs.realpath(process.cwd());
  const key = createHash('sha256').update(options.server).digest('hex').slice(0, 20);
  const stateDir = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'bailey-local-bridge', key);
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 }); await fs.chmod(stateDir, 0o700);
  const unlock = await acquireLock(path.join(stateDir, 'running.pid'));
  const controller = new AbortController();
  let executor, config = { token: '', deviceId: '', roots: [] };
  const stop = () => { controller.abort(); executor?.stopAll(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const configPath = path.join(stateDir, 'connection.json');
    try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取本机连接配置，请检查文件权限。'); }
    const save = async () => { const temp = configPath + '.tmp'; await fs.writeFile(temp, JSON.stringify(config), { mode: 0o600 }); await fs.chmod(temp, 0o600); await fs.rename(temp, configPath); };
    const api = async (endpoint, init = {}) => {
      const response = await fetch(options.server + endpoint, { ...init, headers: { 'content-type': 'application/json', ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) { process.exitCode = 1; stop(); throw new Error('连接已失效，请在 Portal 的「Linux 命令行」重新复制连接命令。'); }
      if (!response.ok) throw new Error(body.detail || `连接失败（${response.status}）`);
      return body;
    };
    let paired;
    if (options.code) {
      paired = await api('/api/local-bridge/agent/pair', { method: 'POST', body: JSON.stringify({ code: options.code, name: os.hostname().slice(0, 120), platform: 'linux-cli' }) });
      if (config.deviceId !== paired.device_id) config.roots = [];
      config.token = paired.token; config.deviceId = paired.device_id;
      await save();
    }
    if (!config.token) throw new Error(`首次使用：在 ${options.server}/?view=workspace 的「使用电脑文件夹 → Linux 命令行」复制连接命令，在当前目录执行。`);
    const { root } = await api('/api/local-bridge/agent/roots', { method: 'POST', body: JSON.stringify({ path: directory, label: (path.basename(directory) || directory).slice(0, 120) }) });
    config.roots = [...config.roots.filter(item => item.id !== root.id), root]; await save();
    if (paired) await api('/api/local-bridge/agent/complete', { method: 'POST', body: JSON.stringify({ connection_id: paired.connection_id, root_id: root.id }) });
    const receipts = path.join(stateDir, 'requests');
    for (const entry of await fs.readdir(receipts).catch(() => [])) { const file = path.join(receipts, entry); const stat = await fs.stat(file).catch(() => null); if (stat && Date.now() - stat.mtimeMs > 7 * 86400000) await fs.rm(file, { force: true }); }
    executor = createExecutor({ getRoots: () => config.roots, journalDir: receipts });
    console.log(`Bailey 本机连接 ${VERSION}\n工作目录：${directory}\n命令以当前电脑账号运行。保持此终端打开，按 Ctrl+C 断开。`);
    console.log(paired ? '目录已提交，Portal 将自动选中此目录。' : '在 Portal 的「使用电脑文件夹」中选择此目录即可继续。');
    console.log(`Portal：${paired?.return_url || options.server + '/?view=workspace'}`);
    let previous;
    await runTransport({ api, executor, signal: controller.signal, onStatus: status => {
      const text = status.connected ? '已连接，等待任务。' : status.error;
      if (text !== previous && (!controller.signal.aborted || !status.connected && !String(status.error).includes('aborted'))) { console.log(status.connected ? text : `${text}${controller.signal.aborted ? '' : '；正在重试…'}`); previous = text; }
    } });
  } finally { stop(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await unlock(); }
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.version) return console.log(VERSION);
  if (options.help) return console.log('用法：bailey-connect [--code 一次性配对码] [--server HTTPS站点]\n在要处理的目录运行；首次从 Portal 复制连接命令。再次运行会复用连接。\n保持终端打开，Ctrl+C 断开并停止本次连接启动的命令。所选目录是默认工作目录，不是系统沙箱。');
  await connect(options);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArgs, connect };
