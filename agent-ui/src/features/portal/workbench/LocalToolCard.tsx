import { useContext, useState } from 'react';
import { Check, File, LoaderCircle, Monitor, SquareArrowOutUpRight, AlertCircle } from 'lucide-react';
import { localBridgeApi } from '../api';
import { LocalWorkspaceContext } from './LocalWorkspace';
export function LocalToolCard(props: { toolName?: string; result?: unknown; isError?: boolean; status?: { type?: string }; args?: Record<string, unknown> }) {
  const local = useContext(LocalWorkspaceContext);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  if (!props.toolName?.includes('local_computer') && !props.toolName?.startsWith('local_')) return null;
  const op = props.toolName.split('.').pop()?.replace(/^local_/, '') || '';
  let output: any = props.result;
  try { if (typeof output === 'string') output = JSON.parse(output); if (Array.isArray(output?.content)) { const item = output.content.find((c: any) => c.type === 'text'); if (item?.text) output = JSON.parse(item.text); } } catch {}
  const failed = props.isError || output?.ok === false || props.status?.type === 'incomplete';
  const running = !failed && (props.status?.type === 'running' || (props.status?.type !== 'complete' && output === undefined));
  const verbs: Record<string, string> = { workspace_info: '查看工作目录', read: '读取文件', list: '浏览文件夹', write: '保存文件', edit: '修改文件', mkdir: '创建文件夹', move: '移动文件', delete: '删除文件', exec: '执行命令', process: '处理命令输出', open: '打开文件', request_result: '核对执行结果' };
  const label = verbs[op] || '处理本机任务';
  const filePath = ['write', 'edit', 'move'].includes(op) && output?.ok && typeof output.path === 'string' ? output.path : null;
  const open = async () => {
    if (!local?.selection?.thread_id || !filePath) return;
    setOpening(true); setError('');
    try { const out = await localBridgeApi<{ ok: boolean; error?: string; pending?: boolean }>(`/api/local-bridge/threads/${local.selection.thread_id}/open`, { method: 'POST', json: { path: filePath } }); if (!out.ok) throw new Error(out.pending ? '电脑尚未返回结果，恢复连接后查看。' : out.error || '打开失败'); }
    catch (e) { setError(e instanceof Error ? e.message : '无法打开文件'); } finally { setOpening(false); }
  };
  return <div className="local-tool-card"><div className="local-tool-status"><Monitor size={17} /><span>{running ? '正在' : failed ? '' : '已在'}{local?.selection?.device_name || '用户电脑'}上{label}{failed ? '未完成' : ''}</span>{running ? <LoaderCircle size={15} className="local-spinner" /> : failed ? <AlertCircle size={15} /> : <Check size={15} />}</div>{filePath ? <div className="local-tool-file"><File size={18} /><strong title={filePath}>{filePath.split(/[\\/]/).pop()}</strong><button type="button" onClick={() => void open()} disabled={opening || local?.offline || !local?.selection?.thread_id}>{opening ? '正在打开…' : '在电脑上打开'}<SquareArrowOutUpRight size={13} /></button></div> : null}{error || failed ? <p role="status">{error || (output.pending ? '等待电脑返回结果' : output?.error || '电脑操作未完成，请检查连接后继续。')}</p> : null}</div>;
}
