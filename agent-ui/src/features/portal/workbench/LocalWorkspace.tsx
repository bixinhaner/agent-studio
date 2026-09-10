import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Modal, Popover } from 'antd';
import { Check, ChevronDown, Computer, Download, Folder, FolderPlus, LoaderCircle, Monitor, Unplug } from 'lucide-react';
import { fetchLocalBridgeDevices, localBridgeApi, type LocalBridgeDevice } from '../api';
import './local-workspace.css';
export type LocalSelection = { id: string; thread_id?: string; root_id: string; path: string; label: string; device_id: string; device_name: string; status: 'online' | 'offline' };
type Connection = { id: string; code: string; launch_url: string; expires_at: string };
export function useLocalWorkspace(threadId: string, enabled: boolean) {
  const [selection, setSelection] = useState<LocalSelection | null>(null);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [devices, setDevices] = useState<LocalBridgeDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [bindingLoadFailed, setBindingLoadFailed] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const connectionAttempt = useRef(0);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const connectionRef = useRef(connection); connectionRef.current = connection;
  const threadRef = useRef(threadId); threadRef.current = threadId;
  const generation = useRef(0);
  const selectionRevision = useRef(0);
  const refresh = useCallback(async () => { const next = await fetchLocalBridgeDevices(); setDevices(next); }, []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const update = async () => {
      try { const next = await fetchLocalBridgeDevices(); if (!alive) return; setDevices(next); setSelection(old => old ? { ...old, status: next.find(d => d.id === old.device_id)?.status || 'offline' } : old); }
      catch { if (alive) setSelection(old => old ? { ...old, status: 'offline' } : old); }
    };
    void update(); const timer = selection?.device_id || dialog ? window.setInterval(() => void update(), 5000) : undefined;
    return () => { alive = false; window.clearInterval(timer); };
  }, [enabled, selection?.device_id, dialog]);
  useEffect(() => {
    const ticket = ++generation.current;
    const selectionVersion = selectionRevision.current;
    connectionAttempt.current++;
    setBindingLoadFailed(false);
    setDialog(false); setError(''); setConnection(null);
    if (connectionRef.current) void localBridgeApi(`/api/local-bridge/connections/${connectionRef.current.id}`, { method: 'DELETE' }).catch(() => {});
    if (!threadId || !enabled) { setSelection(null); setBusy(false); return; }
    setBusy(true);
    void localBridgeApi<{ binding: LocalSelection | null }>(`/api/local-bridge/threads/${threadId}/binding`).then(out => { if (generation.current === ticket && selectionVersion === selectionRevision.current) setSelection(out.binding); }).catch(e => { if (generation.current === ticket && selectionVersion === selectionRevision.current) { setError(e.message); setBindingLoadFailed(true); setSelection(null); } }).finally(() => { if (generation.current === ticket && selectionVersion === selectionRevision.current) setBusy(false); });
  }, [threadId, enabled, loadRevision]);
  const select = useCallback(async (root: LocalSelection | null) => {
    const target = threadRef.current; const ticket = generation.current;
    selectionRevision.current++;
    setBusy(true); setError('');
    try {
      const next = target ? (await localBridgeApi<{ binding: LocalSelection | null }>(`/api/local-bridge/threads/${target}/binding`, { method: 'PUT', json: { root_id: root?.root_id || null } })).binding : root;
      if (ticket === generation.current) { selectionRef.current = next; setSelection(next); }
    } catch (e) { if (ticket === generation.current) setError(e instanceof Error ? e.message : '无法选择文件夹，请重试'); throw e; }
    finally { if (ticket === generation.current) setBusy(false); }
  }, []);
  useEffect(() => {
    const connectionId = new URL(window.location.href).searchParams.get('local_connection');
    if (!connectionId || !enabled) return;
    let alive = true;
    void localBridgeApi<{ status: string; thread_id?: string; selection: LocalSelection | null }>(`/api/local-bridge/connections/${encodeURIComponent(connectionId)}`).then(async out => {
      if (!alive || out.status !== 'completed' || !out.selection || (out.thread_id && out.thread_id !== threadRef.current)) return;
      await select(out.selection);
      if (alive) { const url = new URL(window.location.href); url.searchParams.delete('local_connection'); window.history.replaceState(window.history.state, '', url); }
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [threadId, enabled, select]);
  const close = useCallback(() => { connectionAttempt.current++; setDialog(false); const c = connectionRef.current; setConnection(null); if (c) void localBridgeApi(`/api/local-bridge/connections/${c.id}`, { method: 'DELETE' }).catch(() => {}); }, []);
  const begin = useCallback(() => { setError(''); setDialog(true); }, []);
  const launch = useCallback(async (withCode = false) => {
    setBusy(true); setError(''); const ticket = generation.current; const attempt = ++connectionAttempt.current;
    try {
      if (connectionRef.current) await localBridgeApi(`/api/local-bridge/connections/${connectionRef.current.id}`, { method: 'DELETE' });
      const next = await localBridgeApi<Connection>('/api/local-bridge/connections', { method: 'POST', json: { return_url: window.location.hostname === '127.0.0.1' ? undefined : window.location.href, thread_id: threadRef.current || undefined } });
      if (ticket !== generation.current || attempt !== connectionAttempt.current) { await localBridgeApi(`/api/local-bridge/connections/${next.id}`, { method: 'DELETE' }); return; }
      setConnection(next);
      if (!withCode) window.location.href = next.launch_url;
    } catch (e) { setError(e instanceof Error ? e.message : '无法打开客户端，请重试'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    if (!connection || !dialog) return;
    let alive = true, pending = false;
    const update = async () => {
      if (pending) return; pending = true;
      try {
        const out = await localBridgeApi<{ status: string; selection: LocalSelection | null }>(`/api/local-bridge/connections/${connection.id}`);
        if (!alive) return;
        if (out.status === 'completed' && out.selection) { alive = false; await select(out.selection); setConnection(null); setDialog(false); await refresh(); }
        else if (out.status === 'expired' || out.status === 'cancelled') { setConnection(null); setError(out.status === 'expired' ? '连接已过期，重新打开客户端即可。' : '尚未选择文件夹，可以重新选择。'); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : '正在重试连接'); }
      finally { pending = false; }
    };
    void update(); const timer = window.setInterval(() => void update(), 1200);
    return () => { alive = false; window.clearInterval(timer); };
  }, [connection, dialog, refresh, select]);
  return { bindingLoadFailed, reloadBinding: () => setLoadRevision(v => v + 1), selection, selectionRef, devices, busy, error, dialog, connection, select, refresh, begin, launch, close, enabled, offline: selection?.status === 'offline' };
}
type WorkspaceContext = ReturnType<typeof useLocalWorkspace> & { running: boolean; manage(): void };
export const LocalWorkspaceContext = createContext<WorkspaceContext | null>(null);
export function useLocalWorkspaceReadiness() {
  const local = useContext(LocalWorkspaceContext);
  if (!local?.enabled) return null;
  if (local.bindingLoadFailed) return { status: 'error' as const, notice: '无法确认任务的工作目录，请重试。', retry: async () => local.reloadBinding() };
  if (local.busy) return { status: 'loading' as const, notice: '正在更新工作目录…', retry: async () => {} };
  if (local.offline) return { status: 'error' as const, notice: '电脑暂时离线，打开客户端后继续。', retry: async () => { local.begin(); } };
  return null;
}
export function LocalWorkspaceControls() {
  const local = useContext(LocalWorkspaceContext);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => { const query = window.matchMedia('(max-width: 768px)'); const listener = () => setMobile(query.matches); query.addEventListener('change', listener); return () => query.removeEventListener('change', listener); }, []);
  if (!local?.enabled) return null;
  const choose = async (value: LocalSelection | null) => { try { await local.select(value); setOpen(false); } catch {} };
  const content = <div className="local-folder-menu"><div className="local-folder-menu-title">使用电脑文件夹</div><p className="local-section-label">最近使用</p><div className="local-folder-list">{local.devices.flatMap(d => d.roots.map(r => <button type="button" className={`local-folder-row${local.selection?.root_id === r.id ? ' selected' : ''}`} key={r.id} disabled={local.running || local.busy} title={r.path} onClick={() => void choose({ id: `selection-${r.id}`, root_id: r.id, path: r.path, label: r.label || r.path.split(/[\\/]/).pop() || r.path, device_id: d.id, device_name: d.name, status: d.status })}><Folder size={21} /><span><strong>{r.label || r.path.split(/[\\/]/).pop()}</strong><small><i className={`local-status-dot ${d.status}`} />{d.name} · {d.status === 'online' ? '已连接' : '离线'}</small></span>{local.selection?.root_id === r.id ? <Check size={17} /> : null}</button>))}{!local.devices.some(d => d.roots.length) ? <p className="local-no-folders">选择电脑中的文件夹，让 Agent 开始处理。</p> : null}</div><div className="local-folder-menu-actions"><button type="button" disabled={local.running || local.busy} onClick={() => { setOpen(false); local.begin(); }}><FolderPlus size={17} />选择其他文件夹</button><button type="button" onClick={() => { setOpen(false); local.manage(); }}><Computer size={17} />我的电脑</button>{local.selection ? <button type="button" disabled={local.running || local.busy} onClick={() => void choose(null)}><Unplug size={17} />取消目录绑定</button> : null}</div>{local.running ? <p className="local-menu-hint">停止当前任务后可以切换目录</p> : null}</div>;
  const trigger = <button type="button" className={`local-workspace-trigger${local.selection ? ' has-selection' : ''}${local.offline ? ' is-offline' : ''}`} aria-label="使用电脑文件夹" title={local.selection?.path || '使用电脑文件夹'} onClick={() => setOpen(!open)}><Folder size={16} /><span>{local.selection ? `工作目录：${local.selection.label}` : '使用电脑文件夹'}</span>{local.selection ? <small>· {local.selection.device_name}</small> : null}{local.offline ? <i className="local-status-dot offline" /> : null}<ChevronDown size={13} /></button>;
  return <div className="local-workspace-controls">{mobile ? <>{trigger}<Drawer title={null} closable={false} placement="bottom" open={open} height="auto" onClose={() => setOpen(false)} rootClassName="local-folder-sheet" styles={{ body: { padding: 0 } }}>{content}</Drawer></> : <Popover trigger="click" placement="topLeft" content={content} open={open} onOpenChange={setOpen} overlayClassName="local-folder-popover">{trigger}</Popover>}{local.error && !local.dialog ? <div className="local-workspace-error" role="alert">{local.error}</div> : null}</div>;
}
export function LocalWorkspaceDialogs() {
  const local = useContext(LocalWorkspaceContext);
  const [codeVisible, setCodeVisible] = useState(false);
  if (!local) return null;
  return <Modal open={local.dialog} onCancel={local.close} footer={null} width={480} title="使用电脑文件夹" className="local-connect-modal" destroyOnClose><div className="local-connect-body"><div className="local-connect-icon">{local.connection ? <LoaderCircle className="local-spinner" size={32} /> : <Monitor size={32} />}</div><h3>{local.connection ? '正在等待选择文件夹' : '连接你的电脑'}</h3><p>{local.connection ? '在桌面客户端选择文件夹，完成后会自动回到任务。' : '打开桌面客户端，选择要处理的文件夹。'}</p>{local.error ? <Alert type="warning" message={local.error} showIcon /> : null}<Button block type="primary" size="large" loading={local.busy} onClick={() => { setCodeVisible(false); void local.launch(); }}>{local.connection ? '重新打开客户端' : '打开客户端并选择'}</Button><LocalBridgeDownloads compact /><button type="button" className="local-text-button" onClick={() => { setCodeVisible(true); if (!local.connection) void local.launch(true); }}>使用配对码连接</button>{codeVisible && local.connection ? <div className="local-pair-code"><strong>{local.connection.code}</strong><Button onClick={() => void navigator.clipboard.writeText(local.connection!.code)}>复制</Button><small>在桌面客户端输入，10 分钟内有效</small></div> : null}</div></Modal>;
}
export function LocalBridgeDownloads({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState(!compact);
  return <div className="local-downloads">{compact ? <Button block size="large" icon={<Download size={16} />} onClick={() => setExpanded(!expanded)}>下载桌面客户端</Button> : null}{expanded ? <div className="local-download-options">{[['macOS · Apple 芯片', 'mac-arm64.dmg'], ['macOS · Intel', 'mac-x64.dmg'], ['Windows', 'Windows-x64.exe'], ['Linux', 'Linux-x86_64.AppImage']].map(([label, file]) => <a key={file} href={`/downloads/local-bridge/Agent-Studio-Local-Bridge-latest-${file}`} download><Download size={15} />{label}</a>)}<small>版本 0.2.1</small></div> : null}</div>;
}
