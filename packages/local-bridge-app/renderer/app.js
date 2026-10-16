const root = document.querySelector('#app');
const bridge = window.bridgeApp;
let state = { connected: false, paired: false, roots: [], activity: [], deviceName: '', error: '', paused: false };
let busy = '', enteredCode = '', actionError = '', codeOpen = false;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => (ICONS[name] || '').replace('<svg ', `<svg class="icon ${cls}" `);
const OPS = {
  read: ['fileText', '读取文件'], write: ['filePlus', '写入文件'], edit: ['pencil', '修改文件'], list: ['list', '查看文件夹'],
  exec: ['terminal', '运行命令'], process: ['terminal', '查看命令进度'], mkdir: ['folderPlus', '新建文件夹'], move: ['move', '移动或重命名'],
  delete: ['trash', '删除'], open: ['folderOpen', '打开'], workspace_info: ['info', '了解工作目录']
};
const fileName = target => String(target || '').split(/[\\/]/).filter(Boolean).pop() || target;
function when(ms) {
  if (!ms) return '';
  const date = new Date(ms); const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return date.toDateString() === now.toDateString() ? time : `${date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} ${time}`;
}

/** The one thing the user should know right now, with at most one action. */
function statusView() {
  if (state.authInvalid) return { tone: 'danger', icon: 'circleAlert', title: '连接已失效', text: '这台电脑需要重新连接。请在 Bailey 网页点击「使用电脑文件夹」，再按提示打开本应用。', action: ['portal', '打开 Bailey 网页', 'arrowUpRight', true] };
  if (state.paused) return { tone: 'muted', icon: 'pause', title: '连接已暂停', text: 'Bailey 暂时不能使用这台电脑。恢复后即可继续处理任务。', action: ['pause', '恢复连接', 'play', true] };
  if (!state.connected) return { tone: 'warning', icon: 'loader', spin: true, title: '正在连接…', text: state.error || '正在连接 Bailey 服务器，请稍候。网络恢复后会自动连上，无需操作。' };
  if (state.running) return { tone: 'success', icon: 'loader', spin: true, title: 'Bailey 正在使用这台电脑', text: `正在处理 ${state.running} 项操作。你可以随时停止正在运行的命令。`, action: ['stop', '停止所有命令', 'square', false] };
  return { tone: 'success', icon: 'circleCheck', title: '已连接，可以开始使用', text: '在 Bailey 网页的输入框下方选择「使用电脑文件夹」，就能让 Bailey 处理这台电脑上的文件。', action: ['portal', '打开 Bailey 网页', 'arrowUpRight', false] };
}

function button(id, label, iconName, { primary = false, danger = false, small = false, disabled = false, aria = '' } = {}) {
  const loading = busy === id;
  return `<button type="button" id="${id}" class="btn${primary ? ' primary' : ''}${danger ? ' danger' : ''}${small ? ' small' : ''}" ${disabled || busy ? 'disabled' : ''} ${aria ? `aria-label="${esc(aria)}"` : ''}>${loading ? icon('loader', 'spin') : iconName ? icon(iconName) : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`;
}

function updateNotice() {
  const u = state.update;
  if (!u) return '';
  if (u.status === 'ready') return `<div class="notice info" role="status">${icon('download')}<div><strong>新版本 ${esc(u.latestVersion)} 已准备好</strong><span>重启应用即可完成更新，大约需要几秒钟。空闲时也会自动完成。</span></div>${button('install-update', '重启并更新', 'refresh', { primary: true, small: true })}</div>`;
  if (u.status === 'manual') return `<div class="notice info" role="status">${icon('download')}<div><strong>有新版本 ${esc(u.latestVersion)}</strong><span>${esc(u.error || '这台电脑需要手动安装新版本。')}</span></div>${u.downloadUrl ? button('download-update', '下载新版本', 'arrowUpRight', { small: true }) : ''}</div>`;
  return '';
}

function updateRow() {
  const u = state.update || {};
  const text = {
    checking: '正在检查更新…', latest: '已是最新版本', downloading: `正在下载新版本 ${esc(u.latestVersion)}（${u.progress || 0}%）`,
    ready: `新版本 ${esc(u.latestVersion)} 已下载`, installing: '正在安装更新…', manual: `有新版本 ${esc(u.latestVersion)}`, error: `检查更新失败：${esc(u.error)}`
  }[u.status] || '自动检查更新';
  return `<div class="setting"><div>${icon('download')}<div><strong>软件更新</strong><span>当前版本 ${esc(state.version)} · ${text}</span></div></div>${u.status === 'ready' ? button('install-update-2', '重启并更新', 'refresh', { small: true }) : button('check-update', '检查更新', 'refresh', { small: true, disabled: ['checking', 'downloading', 'installing'].includes(u.status) })}</div>`;
}

function deliveryNotice() {
  if (!state.pendingDeliveries || !state.deliveryError || !state.connected) return '';
  return `<div class="notice warning" role="status">${icon('triangleAlert')}<div><strong>${state.pendingDeliveries} 个操作结果正在重新发送</strong><span>连接正常，结果会自动补发，无需处理。</span></div></div>`;
}

function foldersView() {
  const roots = state.roots || [];
  const list = roots.length ? `<ul class="list">${roots.map(r => `<li class="row"><span class="row-icon folder">${icon('folder')}</span><div class="row-main"><strong>${esc(r.label || fileName(r.path))}</strong><span class="mono" title="${esc(r.path)}">${esc(r.path)}</span></div><div class="row-actions">${button(`open-${r.id}`, '', 'folderOpen', { small: true, aria: `在${state.platform === 'darwin' ? '访达' : '文件管理器'}中打开 ${r.label || r.path}` })}${button(`remove-${r.id}`, '', 'x', { small: true, aria: `从列表移除 ${r.label || r.path}` })}</div></li>`).join('')}</ul>`
    : `<div class="empty">${icon('folder')}<p>还没有文件夹。添加一个文件夹后，Bailey 才能在这台电脑上工作。</p></div>`;
  return `<section class="card" aria-labelledby="folders-title"><div class="card-head"><div><h2 id="folders-title">可使用的文件夹</h2><p>Bailey 只会把这些文件夹作为默认工作位置。</p></div>${button('choose', '添加文件夹', 'folderPlus', { primary: !roots.length, small: Boolean(roots.length), disabled: state.paused })}</div>${list}</section>`;
}

function activityView() {
  const items = state.activity || [];
  const list = items.length ? `<ul class="list">${items.slice(0, 12).map(item => {
    const [iconName, verb] = OPS[item.op] || ['info', item.op];
    const result = item.state === 'running' ? `<span class="pill running">${icon('loader', 'spin')}进行中</span>` : item.state === 'failed' ? `<span class="pill failed" title="${esc(item.error)}">${icon('circleAlert')}未完成</span>` : `<span class="pill done">${icon('check')}完成</span>`;
    const target = item.op === 'exec' ? item.target : fileName(item.target);
    return `<li class="row"><span class="row-icon">${icon(iconName)}</span><div class="row-main"><strong>${esc(verb)}</strong>${target ? `<span class="mono" title="${esc(item.target)}">${esc(target)}</span>` : ''}</div><time datetime="${new Date(item.startedAt).toISOString()}">${when(item.startedAt)}</time>${result}</li>`;
  }).join('')}</ul>` : `<div class="empty">${icon('list')}<p>Bailey 在这台电脑上的操作会显示在这里，方便你随时了解它做了什么。</p></div>`;
  return `<section class="card" aria-labelledby="activity-title"><div class="card-head"><div><h2 id="activity-title">最近操作</h2><p>只保存在本机，关闭应用后清空。</p></div></div>${list}</section>`;
}

function settingsView() {
  const auto = state.autoStart === null || state.autoStart === undefined ? '' : `<div class="setting"><div>${icon('power')}<div><strong id="auto-label">开机自动连接</strong><span>电脑开机后在后台连接，Bailey 随时可以使用这台电脑。</span></div></div><button type="button" id="auto-start" class="switch" role="switch" aria-checked="${state.autoStart ? 'true' : 'false'}" aria-labelledby="auto-label" ${busy ? 'disabled' : ''}><span></span></button></div>`;
  return `<section class="card" aria-labelledby="settings-title"><div class="card-head"><div><h2 id="settings-title">设置</h2></div></div>${auto}${updateRow()}<div class="setting"><div>${icon(state.paused ? 'play' : 'pause')}<div><strong>${state.paused ? '恢复连接' : '暂停连接'}</strong><span>${state.paused ? '恢复后 Bailey 可以继续使用这台电脑。' : '暂停期间 Bailey 不能使用这台电脑，正在运行的命令会停止。'}</span></div></div>${state.paused ? '' : button('pause-2', '暂停', 'pause', { small: true })}</div><div class="setting"><div>${icon('logOut')}<div><strong>退出连接</strong><span>移除这台电脑上保存的连接，文件不受影响。</span></div></div>${button('disconnect', '退出连接', '', { small: true, danger: true })}</div></section>`;
}

function pairedView() {
  const s = statusView();
  const act = s.action ? button(s.action[0], s.action[1], s.action[2], { primary: s.action[3] }) : '';
  return `<section class="status ${s.tone}" aria-labelledby="status-title"><span class="status-icon">${icon(s.icon, s.spin ? 'spin' : '')}</span><div class="status-main"><h1 id="status-title">${esc(s.title)}</h1><p>${esc(s.text)}</p><span class="meta">${icon('monitor')}${esc(state.deviceName || '这台电脑')}</span></div>${act ? `<div class="status-action">${act}</div>` : ''}</section>${updateNotice()}${deliveryNotice()}${foldersView()}${activityView()}${settingsView()}`;
}

function welcomeView() {
  return `<section class="welcome" aria-labelledby="welcome-title"><img src="./brand.png" alt="" width="56" height="56" class="welcome-logo"><h1 id="welcome-title">把这台电脑连接到 Bailey</h1><p class="lead">连接后，Bailey 可以在你选择的文件夹里查看和修改文件、运行命令，帮你完成任务。</p>
  <ol class="steps"><li><span>1</span><div><strong>打开 Bailey 网页并登录</strong><p>点击下方按钮，在浏览器中打开。</p></div></li><li><span>2</span><div><strong>点击输入框下方的「使用电脑文件夹」</strong><p>再选择「打开客户端并选择」。</p></div></li><li><span>3</span><div><strong>浏览器询问时，选择打开本应用</strong><p>然后选一个文件夹，就完成了。</p></div></li></ol>
  ${button('portal', '打开 Bailey 网页', 'arrowUpRight', { primary: true })}
  <details class="code" ${codeOpen ? 'open' : ''}><summary>浏览器没有打开本应用？使用配对码连接</summary><label for="code">Bailey 网页上显示的配对码</label><div class="code-row"><input id="code" name="pairing-code" autocomplete="one-time-code" spellcheck="false" autocapitalize="characters" maxlength="10" value="${esc(enteredCode)}" placeholder="例如 A1B2C3D4E5" class="mono">${button('pair', '连接', '', { primary: true })}</div></details>
  <p class="trust">${icon('shield')}<span>命令会以你的电脑账号运行。Bailey 每次操作都会显示在本应用的「最近操作」里，你可以随时暂停或退出连接。</span></p></section>`;
}

function render() {
  const focused = document.activeElement?.id;
  root.innerHTML = `<header class="topbar"><div class="brand"><img src="./brand.png" alt="" width="24" height="24"><strong>Bailey</strong><span>我的电脑</span></div><span class="version mono">v${esc(state.version || '')}</span></header><div class="page">${actionError ? `<div role="alert" class="notice danger">${icon('circleAlert')}<div><strong>操作没有完成</strong><span>${esc(actionError)}</span></div></div>` : ''}${state.paired ? pairedView() : (state.error ? `<div role="alert" class="notice warning">${icon('triangleAlert')}<div><span>${esc(state.error)}</span></div></div>` : '') + welcomeView()}</div>`;
  if (focused) document.getElementById(focused)?.focus();
}

const actions = {
  portal: () => bridge.openPortal(), pair: () => bridge.pair(enteredCode.trim()), choose: () => bridge.chooseRoot(),
  pause: () => bridge.pause(), 'pause-2': () => bridge.pause(), disconnect: () => bridge.disconnect(), stop: () => bridge.stopCommands(),
  'auto-start': () => bridge.setAutoStart(!state.autoStart), 'check-update': () => bridge.checkUpdate(),
  'install-update': () => bridge.installUpdate(), 'install-update-2': () => bridge.installUpdate(), 'download-update': () => bridge.downloadUpdate()
};
root.addEventListener('click', async event => {
  const target = event.target.closest('button[id]');
  if (!target || busy) return;
  const id = target.id;
  const run = actions[id] || (id.startsWith('open-') ? () => bridge.openRoot(id.slice(5)) : id.startsWith('remove-') ? () => bridge.removeRoot(id.slice(7)) : null);
  if (!run) return;
  busy = id; actionError = ''; render();
  try { const next = await run(); if (next && typeof next === 'object' && 'paired' in next) state = next; }
  catch (error) { actionError = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  finally { busy = ''; render(); }
});
root.addEventListener('toggle', event => { if (event.target.matches?.('details.code')) codeOpen = event.target.open; }, true);
root.addEventListener('input', event => { if (event.target.id === 'code') enteredCode = event.target.value; });
root.addEventListener('keydown', event => { if (event.target.id === 'code' && event.key === 'Enter') document.getElementById('pair')?.click(); });
bridge.getState().then(value => { state = value; render(); });
bridge.onState(value => { state = value; render(); });
