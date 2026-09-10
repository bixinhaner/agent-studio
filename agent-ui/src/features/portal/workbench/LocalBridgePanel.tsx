import { useContext, useEffect, useState } from 'react';
import { Alert, Button, Drawer } from 'antd';
import { Computer, Folder, Plus, Trash2 } from 'lucide-react';
import { revokeLocalBridgeDevice } from '../api';
import { LocalBridgeDownloads, LocalWorkspaceContext } from './LocalWorkspace';
export function LocalBridgePanel(props: { open: boolean; onClose(): void }) {
  const local = useContext(LocalWorkspaceContext);
  const [error, setError] = useState('');
  useEffect(() => { if (props.open) void local?.refresh().catch(e => setError(e.message)); }, [props.open, local?.refresh]);
  if (!local) return null;
  return <Drawer open={props.open} onClose={props.onClose} width={520} title="我的电脑" rootClassName="local-computer-drawer"><p className="local-management-intro">连接电脑后，在任务中选择工作目录即可开始。</p>{error ? <Alert type="error" message={error} /> : null}<div className="local-management-heading"><span>我的设备</span><Button type="primary" icon={<Plus size={16} />} onClick={() => { props.onClose(); local.begin(); }}>连接电脑</Button></div>{local.devices.length ? local.devices.map(device => <section className="local-device-card" key={device.id}><div className="local-device-heading"><div className="local-device-icon"><Computer size={24} /></div><div><strong>{device.name}</strong><small><i className={`local-status-dot ${device.status}`} />{device.status === 'online' ? '已连接' : '离线'} · {device.platform}</small></div><Button type="text" aria-label={`移除 ${device.name}`} icon={<Trash2 size={16} />} onClick={async () => { try { await revokeLocalBridgeDevice(device.id); await local.refresh(); } catch (e) { setError(e instanceof Error ? e.message : '移除失败，请重试'); } }} /></div><div className="local-device-folders">{device.roots.map(root => <div key={root.id}><Folder size={16} /><span>{root.label || root.path}<small title={root.path}>{root.path}</small></span></div>)}</div><Button block onClick={() => { props.onClose(); local.begin(); }}>选择文件夹</Button></section>) : <div className="local-management-empty"><Computer size={40} /><p>还没有连接电脑</p><small>打开桌面客户端，选择文件夹后自动连接。</small></div>}<div className="local-management-download"><h3>桌面客户端</h3><LocalBridgeDownloads /></div><p className="local-management-note">命令以你的电脑账号运行，所选文件夹是默认工作目录。</p></Drawer>;
}
