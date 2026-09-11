import { useContext, useEffect, useState } from 'react';
import { Alert, Button, Drawer } from 'antd';
import { Computer, Folder, Plus, Trash2 } from 'lucide-react';
import { usePortalI18n } from '../i18n';
import { revokeLocalBridgeDevice } from '../api';
import { LocalBridgeDownloads, LocalWorkspaceContext } from './LocalWorkspace';
export function LocalBridgePanel(props: { open: boolean; onClose(): void }) {
  const { t } = usePortalI18n();
  const local = useContext(LocalWorkspaceContext);
  const [error, setError] = useState<"devices" | "remove" | null>(null);
  useEffect(() => { if (props.open) void local?.refresh().catch(() => setError("devices")); }, [props.open, local?.refresh]);
  if (!local) return null;
  return <Drawer open={props.open} onClose={props.onClose} width={520} title={t("localWorkspace.myComputer")} rootClassName="local-computer-drawer"><p className="local-management-intro">{t("localWorkspace.managementIntro")}</p>{error ? <Alert type="error" message={t(error === "devices" ? "localWorkspace.devicesFailed" : "localWorkspace.removeFailed")} /> : null}<div className="local-management-heading"><span>{t("localWorkspace.myDevices")}</span><Button type="primary" icon={<Plus size={16} />} onClick={() => { props.onClose(); local.begin(); }}>{t("localWorkspace.connectComputer")}</Button></div>{local.devices.length ? local.devices.map(device => <section className="local-device-card" key={device.id}><div className="local-device-heading"><div className="local-device-icon"><Computer size={24} /></div><div><strong>{device.name}</strong><small><i className={`local-status-dot ${device.status}`} />{device.status === 'online' ? t("localWorkspace.connected") : t("localWorkspace.offline")} · {device.platform}</small></div><Button type="text" aria-label={t("localWorkspace.removeDevice", { name: device.name })} icon={<Trash2 size={16} />} onClick={async () => { try { await revokeLocalBridgeDevice(device.id); await local.refresh(); } catch (e) { setError("remove"); } }} /></div><div className="local-device-folders">{device.roots.map(root => <div key={root.id}><Folder size={16} /><span>{root.label || root.path}<small title={root.path}>{root.path}</small></span></div>)}</div><Button block onClick={() => { props.onClose(); local.begin(); }}>{t("localWorkspace.chooseFolder")}</Button></section>) : <div className="local-management-empty"><Computer size={40} /><p>{t("localWorkspace.emptyDevices")}</p><small>{t("localWorkspace.emptyDevicesHelp")}</small></div>}<div className="local-management-download"><h3>{t("localWorkspace.desktopApp")}</h3><LocalBridgeDownloads /></div><p className="local-management-note">{t("localWorkspace.trustedMode")}</p></Drawer>;
}
