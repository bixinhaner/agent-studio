import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Modal, Popover } from 'antd';
import { Check, ChevronDown, Cloud, Computer, Download, Ellipsis, Folder, FolderPlus, LoaderCircle, Monitor, Terminal, Trash2, X } from 'lucide-react';
import { fetchLocalBridgeDevices, localBridgeApi, revokeLocalBridgeDevice, type LocalBridgeDevice } from '../api';
import { usePortalI18n } from '../i18n';
import './local-workspace.css';
export type LocalSelection = { id: string; thread_id?: string; root_id: string; path: string; label: string; device_id: string; device_name: string; status: 'online' | 'offline' };
type Connection = { id: string; code: string; launch_url: string; expires_at: string };
export function useLocalWorkspace(threadId: string, enabled: boolean) {
  const { t } = usePortalI18n();
  const translate = useRef(t); translate.current = t;
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
  const removedDevices = useRef(new Set<string>());
  const removing = useRef(false);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const applyDevices = useCallback((next: LocalBridgeDevice[]) => {
    const visible = next.filter(device => !removedDevices.current.has(device.id));
    setDevices(visible);
    setSelection(old => old ? { ...old, status: visible.find(device => device.id === old.device_id)?.status || 'offline' } : old);
  }, []);
  const refresh = useCallback(async () => { applyDevices(await fetchLocalBridgeDevices()); }, [applyDevices]);
  const removeDevice = useCallback(async (deviceId: string) => {
    if (removing.current) return;
    removing.current = true;
    setRemovingDeviceId(deviceId); setError('');
    try {
      await revokeLocalBridgeDevice(deviceId);
      removedDevices.current.add(deviceId);
      setDevices(old => old.filter(device => device.id !== deviceId));
      // Preserve the current location as unavailable until the user explicitly chooses another workspace.
      setSelection(old => old?.device_id === deviceId ? { ...old, status: 'offline' } : old);
    } catch (error) { setError(translate.current('localWorkspace.removeFailed')); throw error; }
    finally { removing.current = false; setRemovingDeviceId(null); }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const update = async () => {
      try { const next = await fetchLocalBridgeDevices(); if (!alive) return; applyDevices(next); }
      catch { if (alive) setSelection(old => old ? { ...old, status: 'offline' } : old); }
    };
    void update(); const timer = selection?.device_id || dialog ? window.setInterval(() => void update(), 5000) : undefined;
    return () => { alive = false; window.clearInterval(timer); };
  }, [enabled, selection?.device_id, dialog, applyDevices]);
  useEffect(() => {
    const ticket = ++generation.current;
    const selectionVersion = selectionRevision.current;
    connectionAttempt.current++;
    setBindingLoadFailed(false);
    setDialog(false); setError(''); setConnection(null);
    if (connectionRef.current) void localBridgeApi(`/api/local-bridge/connections/${connectionRef.current.id}`, { method: 'DELETE' }).catch(() => {});
    if (!threadId || !enabled) { setSelection(null); setBusy(false); return; }
    setBusy(true);
    void localBridgeApi<{ binding: LocalSelection | null }>(`/api/local-bridge/threads/${threadId}/binding`).then(out => { if (generation.current === ticket && selectionVersion === selectionRevision.current) setSelection(out.binding); }).catch(e => { if (generation.current === ticket && selectionVersion === selectionRevision.current) { setError(translate.current("localWorkspace.bindingFailed")); setBindingLoadFailed(true); setSelection(null); } }).finally(() => { if (generation.current === ticket && selectionVersion === selectionRevision.current) setBusy(false); });
  }, [threadId, enabled, loadRevision]);
  const select = useCallback(async (root: LocalSelection | null) => {
    const target = threadRef.current; const ticket = generation.current;
    selectionRevision.current++;
    setBusy(true); setError('');
    try {
      const next = target ? (await localBridgeApi<{ binding: LocalSelection | null }>(`/api/local-bridge/threads/${target}/binding`, { method: 'PUT', json: { root_id: root?.root_id || null } })).binding : root;
      if (ticket === generation.current) { selectionRef.current = next; setSelection(next); }
    } catch (e) { if (ticket === generation.current) setError(translate.current("localWorkspace.selectFailed")); throw e; }
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
    }).catch(e => { if (alive) setError(translate.current("localWorkspace.retrying")); });
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
    } catch (e) { setError(translate.current("localWorkspace.launchFailed")); }
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
        else if (out.status === 'expired' || out.status === 'cancelled') { setConnection(null); setError(out.status === 'expired' ? translate.current("localWorkspace.expired") : translate.current("localWorkspace.cancelled")); }
      } catch (e) { if (alive) setError(translate.current("localWorkspace.retrying")); }
      finally { pending = false; }
    };
    void update(); const timer = window.setInterval(() => void update(), 1200);
    return () => { alive = false; window.clearInterval(timer); };
  }, [connection, dialog, refresh, select]);
  return { bindingLoadFailed, reloadBinding: () => setLoadRevision(v => v + 1), selection, selectionRef, devices, busy: busy || removingDeviceId !== null, removingDeviceId, removeDevice, removedSelection: !!selection && removedDevices.current.has(selection.device_id), error, dialog, connection, select, refresh, begin, launch, close, enabled, offline: selection?.status === 'offline' };
}
type WorkspaceContext = ReturnType<typeof useLocalWorkspace> & { showEntry: boolean; running: boolean };
export const LocalWorkspaceContext = createContext<WorkspaceContext | null>(null);
export function useLocalWorkspaceReadiness(): { status: 'loading' | 'error'; notice: string; actionLabel?: string; retry(): Promise<void> } | null {
  const { t } = usePortalI18n();
  const local = useContext(LocalWorkspaceContext);
  if (!local?.enabled) return null;
  if (local.bindingLoadFailed) return { status: 'error' as const, notice: t("localWorkspace.bindingFailed"), retry: async () => local.reloadBinding() };
  if (local.busy) return { status: 'loading' as const, notice: t("localWorkspace.updating"), retry: async () => {} };
  if (local.removedSelection) return { status: 'error' as const, notice: t('localWorkspace.removedSelection'), actionLabel: t('localWorkspace.addFolder'), retry: async () => local.begin() };
  if (local.offline && local.devices.find(device => device.id === local.selection?.device_id)?.platform === 'linux-cli') return { status: 'error' as const, notice: t("localWorkspace.linuxOffline"), actionLabel: t("localWorkspace.connectionHelp"), retry: async () => local.begin() };
  if (local.offline) return { status: 'error' as const, notice: t("localWorkspace.desktopOffline"), actionLabel: t("localWorkspace.openApp"), retry: async () => { window.location.href = 'agent-studio://connect'; } };
  return null;
}
export function LocalWorkspaceControls() {
  const { t } = usePortalI18n();
  const local = useContext(LocalWorkspaceContext);
  const [open, setOpen] = useState(false);
  const [moreDeviceId, setMoreDeviceId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const deviceTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => { const query = window.matchMedia('(max-width: 768px)'); const listener = () => setMobile(query.matches); query.addEventListener('change', listener); return () => query.removeEventListener('change', listener); }, []);
  useEffect(() => { if (!local?.showEntry) { setOpen(false); setMoreDeviceId(null); } }, [local?.showEntry]);
  if (!local?.enabled || !local.showEntry) return null;
  const changeOpen = (next: boolean) => { setOpen(next); if (!next) setMoreDeviceId(null); };
  const close = () => { changeOpen(false); triggerRef.current?.focus(); };
  const choose = async (value: LocalSelection | null) => { try { await local.select(value); close(); } catch {} };
  const disabled = local.running || local.busy;
  const devices = [...local.devices].sort((a, b) => Number(b.id === local.selection?.device_id) - Number(a.id === local.selection?.device_id));
  const content = <div className="local-folder-menu" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  }}>
    <div className="local-folder-menu-heading"><strong>{t('localWorkspace.menuTitle')}</strong>{mobile ? <button type="button" className="local-menu-close" onClick={close} aria-label={t('common.close')}><X size={19} /></button> : null}</div>
    <button type="button" className={`local-folder-row local-cloud-row${!local.selection ? ' selected' : ''}`} disabled={disabled} aria-pressed={!local.selection} onClick={() => void choose(null)}><Cloud size={21} /><span>{t('localWorkspace.cloud')}</span>{!local.selection ? <Check size={17} /> : null}</button>
    <div className="local-folder-list">
      {devices.map(device => <section className="local-folder-device" key={device.id} aria-label={device.name}>
        <div className="local-folder-device-heading">
          {device.platform === 'linux-cli' ? <Terminal size={21} /> : <Computer size={21} />}
          <strong title={device.name}>{device.name}</strong>
          <span className="local-folder-device-status"><i className={`local-status-dot ${device.status}`} />{device.status === 'online' ? t('localWorkspace.connected') : t('localWorkspace.offline')}</span>
          <Popover trigger="click" destroyOnHidden placement={mobile ? 'topRight' : 'rightTop'} open={open && moreDeviceId === device.id} onOpenChange={next => setMoreDeviceId(next && open ? device.id : null)} overlayClassName="local-device-action-popover" content={
            <div className="local-device-action-menu" role="menu" aria-label={t('localWorkspace.deviceActions', { name: device.name })} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setMoreDeviceId(null); deviceTriggers.current[device.id]?.focus(); } }}>
              <button type="button" role="menuitem" autoFocus disabled={disabled} onClick={async () => { try { await local.removeDevice(device.id); setMoreDeviceId(null); triggerRef.current?.focus(); } catch {} }}>
                {local.removingDeviceId === device.id ? <LoaderCircle size={17} className="local-spinner" /> : <Trash2 size={17} />}<span>{t('localWorkspace.removeConnection')}</span>
              </button>
              <p>{t('localWorkspace.removeConnectionHint')}</p>
            </div>
          }><button ref={node => { deviceTriggers.current[device.id] = node; }} type="button" className="local-device-more" aria-label={t('localWorkspace.deviceActions', { name: device.name })} aria-haspopup="menu" aria-expanded={moreDeviceId === device.id} disabled={disabled} title={local.running ? t('localWorkspace.runningHint') : undefined} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setMoreDeviceId(device.id); } }}><Ellipsis size={20} /></button></Popover>
        </div>
        <div className="local-folder-device-roots">{device.roots.map(root => <button type="button" className={`local-folder-row${local.selection?.root_id === root.id ? ' selected' : ''}`} key={root.id} disabled={disabled} title={root.path} aria-pressed={local.selection?.root_id === root.id} onClick={() => void choose({ id: `selection-${root.id}`, root_id: root.id, path: root.path, label: root.label || root.path.split(/[\\/]/).pop() || root.path, device_id: device.id, device_name: device.name, status: device.status })}><Folder size={21} /><span>{root.label || root.path.split(/[\\/]/).pop() || root.path}</span>{local.selection?.root_id === root.id ? <Check size={17} /> : null}</button>)}{!device.roots.length ? <p className="local-no-device-folders">{t('localWorkspace.noDeviceFolders')}</p> : null}</div>
      </section>)}
      {!devices.length ? <p className="local-no-folders">{t('localWorkspace.emptyFolders')}</p> : null}
    </div>
    <div className="local-folder-menu-actions"><button type="button" disabled={disabled} onClick={() => { changeOpen(false); local.begin(); }}><FolderPlus size={21} /><span>{t('localWorkspace.addFolder')}</span></button></div>
    {local.running ? <p className="local-menu-hint">{t('localWorkspace.runningHint')}</p> : null}
  </div>;
  const trigger = <button ref={triggerRef} type="button" className={`local-workspace-trigger${local.selection ? ' has-selection' : ''}${local.offline ? ' is-offline' : ''}`} aria-label={t('localWorkspace.title')} aria-expanded={open} title={local.selection ? `${local.selection.device_name}\n${local.selection.path}` : t('localWorkspace.cloudHint')} onClick={() => changeOpen(!open)}>{local.selection ? <Folder size={16} /> : <Cloud size={16} />}<span>{local.selection ? t('localWorkspace.localLabel', { name: local.selection.label }) : t('localWorkspace.cloud')}</span>{local.offline ? <small>{t('localWorkspace.offline')}</small> : null}<ChevronDown size={13} /></button>;
  // Update closing content before unmounting it: Popover's default cache can keep the nested portal open.
  return <div className="local-workspace-controls">{mobile ? <>{trigger}<Drawer title={null} closable={false} placement="bottom" open={open} height="auto" onClose={close} destroyOnHidden rootClassName="local-folder-sheet" styles={{ body: { padding: 0 } }}>{content}</Drawer></> : <Popover trigger="click" placement="topLeft" content={content} open={open} onOpenChange={changeOpen} fresh destroyOnHidden overlayClassName="local-folder-popover">{trigger}</Popover>}{local.error && !local.dialog ? <div className="local-workspace-error" role="alert">{local.error}</div> : null}</div>;
}
export function LocalWorkspaceDialogs() {
  const { t } = usePortalI18n();
  const local = useContext(LocalWorkspaceContext);
  const [codeVisible, setCodeVisible] = useState(false);
  const [linux, setLinux] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  useEffect(() => { setCopied(false); setCopyError(''); }, [local?.connection?.id, local?.dialog]);
  const command = local?.connection ? `curl -fsSL https://bailey.baicells.com/downloads/local-bridge/connect.sh | bash -s -- --code ${local.connection.code}` : '';
  const copy = async () => { try { await navigator.clipboard.writeText(command); setCopied(true); setCopyError(''); } catch { setCopyError(t("localWorkspace.copyFailed")); } };
  if (!local?.showEntry) return null;
  return <Modal open={local.dialog} onCancel={local.close} footer={null} width={520} title={t("localWorkspace.title")} className="local-connect-modal" destroyOnClose>
    <div className="local-connect-mode" role="group" aria-label={t("localWorkspace.connectionMode")}>
      <Button type={linux ? 'text' : 'default'} onClick={() => { setLinux(false); local.close(); local.begin(); }}><Monitor size={16} />{t("localWorkspace.desktopApp")}</Button>
      <Button type={linux ? 'default' : 'text'} onClick={() => { setLinux(true); setCodeVisible(false); void local.launch(true); }} loading={linux && local.busy}><Terminal size={16} />{t("localWorkspace.linuxCli")}</Button>
    </div>
    <div className="local-connect-body">
      <div className="local-connect-icon">{local.connection ? <LoaderCircle className="local-spinner" size={32} /> : linux ? <Terminal size={32} /> : <Monitor size={32} />}</div>
      <h3>{linux ? t("localWorkspace.linuxTitle") : local.connection ? t("localWorkspace.waitingTitle") : t("localWorkspace.connectTitle")}</h3>
      <p>{linux ? t("localWorkspace.linuxHelp") : local.connection ? t("localWorkspace.waitingHelp") : t("localWorkspace.connectHelp")}</p>
      {local.error ? <Alert type="warning" message={local.error} showIcon /> : null}
      {linux ? <>
        {command ? <><pre className="local-linux-command" tabIndex={0} aria-label={t("localWorkspace.linuxCommand")}>{command}</pre><Button block type="primary" size="large" onClick={() => void copy()}>{copied ? t("localWorkspace.copiedCommand") : t("localWorkspace.copyCommand")}</Button><small className="local-linux-help">{t("localWorkspace.commandLifetime")}<br />{t("localWorkspace.keepTerminal")}</small>{copyError ? <Alert type="info" message={copyError} /> : null}</> : null}
        <Button block type={command ? 'text' : 'primary'} loading={local.busy} onClick={() => void local.launch(true)}>{command ? t("localWorkspace.regenerate") : t("localWorkspace.generate")}</Button>
      </> : <>
        <Button block type="primary" size="large" loading={local.busy} onClick={() => { setCodeVisible(false); void local.launch(); }}>{local.connection ? t("localWorkspace.reopenApp") : t("localWorkspace.openAndChoose")}</Button>
        <LocalBridgeDownloads compact />
        <button type="button" className="local-text-button" onClick={() => { setCodeVisible(true); if (!local.connection) void local.launch(true); }}>{t("localWorkspace.pairingCode")}</button>
        {codeVisible && local.connection ? <div className="local-pair-code"><strong>{local.connection.code}</strong><Button onClick={() => void navigator.clipboard.writeText(local.connection!.code)}>{t("common.copy")}</Button><small>{t("localWorkspace.pairingHelp")}</small></div> : null}
      </>}
    </div>
  </Modal>;
}
export function LocalBridgeDownloads({ compact = false }: { compact?: boolean }) {
  const { t } = usePortalI18n();
  const [expanded, setExpanded] = useState(!compact);
  return <div className="local-downloads">{compact ? <Button block size="large" icon={<Download size={16} />} onClick={() => setExpanded(!expanded)}>{t("localWorkspace.downloadApp")}</Button> : null}{expanded ? <div className="local-download-options">{[[t("localWorkspace.appleSilicon"), 'mac-arm64.dmg'], ['macOS · Intel', 'mac-x64.dmg'], ['Windows', 'Windows-x64.exe'], [t("localWorkspace.linuxDesktop"), 'Linux-x86_64.AppImage']].map(([label, file]) => <a key={file} href={`/downloads/local-bridge/Agent-Studio-Local-Bridge-latest-${file}`} download><Download size={15} />{label}</a>)}<small>{t("localWorkspace.version", { version: "0.2.3" })}</small></div> : null}</div>;
}
