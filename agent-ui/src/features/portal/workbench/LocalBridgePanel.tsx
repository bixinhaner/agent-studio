import { useEffect, useState } from "react";
import { Alert, Button, Drawer, Input, Modal, Tag } from "antd";
import { CheckCircle2, Computer, Copy, Download, FolderPlus, ShieldCheck, Trash2, WifiOff } from "lucide-react";
import { addLocalBridgeRoot, createLocalBridgePairing, fetchLocalBridgeDevices, revokeLocalBridgeDevice, type LocalBridgeDevice } from "../api";

export function LocalBridgePanel(props: { open: boolean; onClose(): void }) {
  const [devices, setDevices] = useState<LocalBridgeDevice[]>([]); const [pairing, setPairing] = useState<string | null>(null); const [rootDevice, setRootDevice] = useState<LocalBridgeDevice | null>(null); const [rootPath, setRootPath] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const refresh = () => fetchLocalBridgeDevices().then(setDevices).catch(() => setDevices([]));
  useEffect(() => { if (props.open) void refresh(); }, [props.open]);
  const pair = async () => { setError(""); try { const result = await createLocalBridgePairing(); setPairing(result.code); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法创建配对码，请稍后重试"); } };
  const addRoot = async () => { if (!rootDevice || !rootPath.trim()) return; setBusy(true); try { await addLocalBridgeRoot(rootDevice.id, rootPath.trim()); setRootPath(""); setRootDevice(null); await refresh(); } finally { setBusy(false); } };
  return <Drawer open={props.open} onClose={props.onClose} width={560} title="我的电脑" rootClassName="local-bridge-drawer">
    <div className="local-bridge-intro"><div><h2>让云端工作区连接你的电脑</h2><p>只会访问你明确授权的目录。连接由本机主动建立，不需要开放公网端口。</p></div><ShieldCheck size={28} /></div>
    {error ? <Alert type="error" showIcon message="连接失败" description={error} closable onClose={() => setError("")} /> : null}
    <div className="local-bridge-toolbar"><span>已连接的设备</span><Button type="primary" onClick={() => void pair()}>连接新电脑</Button></div>
    {devices.length === 0 ? <div className="local-bridge-empty"><Computer size={34} /><p>还没有连接设备</p><small>在这台电脑上启动 Local Bridge，然后使用配对码完成绑定。</small></div> : devices.map((device) => <section className="local-bridge-card" key={device.id}><div className="local-bridge-card-head"><div className="local-bridge-device-icon"><Computer size={22} /></div><div className="local-bridge-device-meta"><strong>{device.name}</strong><span>{device.platform || "本机"}</span><Tag color={device.status === "online" ? "success" : "default"} icon={device.status === "online" ? <CheckCircle2 size={12} /> : <WifiOff size={12} />}>{device.status === "online" ? "已连接" : "未连接"}</Tag></div><Button danger type="text" aria-label="撤销设备" icon={<Trash2 size={16} />} onClick={async () => { await revokeLocalBridgeDevice(device.id); await refresh(); }} /></div><div className="local-bridge-roots"><div className="local-bridge-section-label">授权目录</div>{device.roots.map((root) => <div className="local-bridge-root" key={root.id}><span>{root.label || root.path}</span><small>仅此目录</small></div>)}<Button block icon={<FolderPlus size={16} />} onClick={() => setRootDevice(device)}>选择目录</Button></div></section>)}
    <div className="local-bridge-downloads">
      <div className="local-bridge-section-label">下载桌面应用</div>
      <p>先在你的电脑上安装并打开 Local Bridge，再使用上面的配对码完成连接。</p>
      <div className="local-bridge-download-grid">
        {[
          ["macOS", "Apple 芯片（arm64）", "Agent-Studio-Local-Bridge-latest-mac-arm64.dmg"],
          ["Windows", "Windows 10 或更高版本", "Agent-Studio-Local-Bridge-latest-Windows-x64.exe"],
          ["Linux", "AppImage，无需安装", "Agent-Studio-Local-Bridge-latest-Linux-x86_64.AppImage"]
        ].map(([platform, description, file]) => <a className="local-bridge-download-card" href={`/downloads/local-bridge/${file}`} key={platform}><span className="local-bridge-download-icon"><Download size={16} /></span><span><strong>{platform}</strong><small>{description}</small></span><span className="local-bridge-download-arrow">↗</span></a>)}
      </div>
      <small className="local-bridge-release-note">当前版本 0.1.0 · 下载后直接打开即可</small>
    </div>
    <div className="local-bridge-note"><ShieldCheck size={18} /><span>云端 AI 只能访问你选择的目录，不会自动读取其他文件。</span></div>
    <Modal open={Boolean(pairing)} title="在电脑上完成绑定" footer={<Button onClick={() => setPairing(null)}>关闭</Button>} onCancel={() => setPairing(null)}><p>在本机启动 Local Bridge，输入下面的一次性配对码：</p><div className="local-bridge-code"><strong>{pairing}</strong><Button icon={<Copy size={16} />} onClick={() => pairing && navigator.clipboard?.writeText(pairing)}>复制</Button></div><small>配对码 10 分钟内有效，使用后立即失效。</small></Modal>
    <Modal open={Boolean(rootDevice)} title={`为 ${rootDevice?.name} 授权目录`} okText="保存目录" cancelText="取消" confirmLoading={busy} onOk={() => void addRoot()} onCancel={() => setRootDevice(null)}><Input autoFocus value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder="例如 /Users/like/Projects/my-app" /><p className="local-bridge-help">目录路径只保存在本机执行端的授权范围中。</p></Modal>
  </Drawer>;
}
