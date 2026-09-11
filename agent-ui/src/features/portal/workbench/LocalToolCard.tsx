import { useContext, useState } from 'react';
import { Check, File, LoaderCircle, Monitor, SquareArrowOutUpRight, AlertCircle, Copy } from 'lucide-react';
import { localBridgeApi } from '../api';
import { usePortalI18n, type PortalMessageKey } from '../i18n';
import { LocalWorkspaceContext } from './LocalWorkspace';
export function LocalToolCard(props: { toolName?: string; result?: unknown; isError?: boolean; status?: { type?: string }; args?: Record<string, unknown> }) {
  const local = useContext(LocalWorkspaceContext);
  const { t } = usePortalI18n();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<PortalMessageKey | null>(null);
  const [copied, setCopied] = useState(false);
  const headless = local?.devices?.find(device => device.id === local.selection?.device_id)?.platform === 'linux-cli';
  if (!props.toolName?.includes('local_computer') && !props.toolName?.startsWith('local_')) return null;
  const op = props.toolName.split('.').pop()?.replace(/^local_/, '') || '';
  let output: any = props.result;
  try { if (typeof output === 'string') output = JSON.parse(output); if (Array.isArray(output?.content)) { const item = output.content.find((c: any) => c.type === 'text'); if (item?.text) output = JSON.parse(item.text); } } catch {}
  const failed = props.isError || output?.ok === false || props.status?.type === 'incomplete';
  const running = !failed && (props.status?.type === 'running' || (props.status?.type !== 'complete' && output === undefined));
  const verbs: Record<string, PortalMessageKey> = { workspace_info: 'localTool.workspaceInfo', read: 'localTool.read', list: 'localTool.list', write: 'localTool.write', edit: 'localTool.edit', mkdir: 'localTool.mkdir', move: 'localTool.move', delete: 'localTool.delete', exec: 'localTool.exec', process: 'localTool.process', open: 'localTool.open', request_result: 'localTool.requestResult' };
  const label = t(verbs[op] || 'localTool.task');
  const filePath = ['write', 'edit', 'move'].includes(op) && output?.ok && typeof output.path === 'string' ? output.path : null;
  const open = async () => {
    if (!filePath) return;
    if (headless) { try { await navigator.clipboard.writeText(filePath); setCopied(true); setError(null); } catch { setError('localTool.copyFailed'); } return; }
    if (!local?.selection?.thread_id) return;
    setOpening(true); setError(null);
    try { const out = await localBridgeApi<{ ok: boolean; error?: string; pending?: boolean }>(`/api/local-bridge/threads/${local.selection.thread_id}/open`, { method: 'POST', json: { path: filePath } }); if (!out.ok) setError(out.pending ? 'localTool.openPending' : 'localTool.openFailed'); }
    catch { setError('localTool.openFailed'); } finally { setOpening(false); }
  };
  return <div className="local-tool-card">
    <div className="local-tool-status"><Monitor size={17} /><span>{t(running ? 'localTool.running' : failed ? 'localTool.incomplete' : 'localTool.complete', { device: local?.selection?.device_name || t('localTool.computer'), action: label })}</span>{running ? <LoaderCircle size={15} className="local-spinner" /> : failed ? <AlertCircle size={15} /> : <Check size={15} />}</div>
    {filePath ? <div className="local-tool-file"><File size={18} /><strong title={filePath}>{filePath.split(/[\\/]/).pop()}</strong><button type="button" onClick={() => void open()} disabled={opening || (!headless && (local?.offline || !local?.selection?.thread_id))}>{headless ? copied ? t('common.copied') : t('localTool.copyPath') : opening ? t('localTool.opening') : t('localTool.openOnComputer')}{headless ? <Copy size={13} /> : <SquareArrowOutUpRight size={13} />}</button></div> : null}
    {error || failed ? <p role="status">{error ? t(error) : output?.pending ? t('localTool.waiting') : output?.error || t('localTool.failed')}</p> : null}
  </div>;
}
