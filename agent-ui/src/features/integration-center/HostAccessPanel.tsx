import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, Popconfirm, Space, Table, Tag, Typography } from "antd";

import { api } from "../../lib/api";

type HostKey = { id: string; label: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
type HostDevice = { id: string; name: string; platform: string | null; client_version: string | null; last_seen_at: string | null; created_at: string; online: boolean };
type HostAccess = { keys: HostKey[]; devices: HostDevice[] };

const base = (instanceId: string) => `/api/admin/integrations/${encodeURIComponent(instanceId)}/host-access`;
const time = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");

/**
 * Connects a business system's host to this connector. The administrator issues an access key
 * here and enters it, with Bailey's address, in the business system's settings page; the
 * system's agent-host then registers itself and appears under "已连接的主机".
 */
export function HostAccessPanel(props: { instanceId: string; canWrite?: boolean }) {
  const [data, setData] = useState<HostAccess | null>(null);
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<{ label: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<HostAccess>(base(props.instanceId))); setErrorText(""); }
    catch (error) { setErrorText(error instanceof Error ? error.message : "加载失败"); }
  }, [props.instanceId]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10000); return () => window.clearInterval(timer); }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setErrorText("");
    try { await action(); await load(); }
    catch (error) { setErrorText(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  const createKey = () => run(async () => {
    const result = await api<HostKey & { key: string }>(`${base(props.instanceId)}/keys`, { method: "POST", json: { label } });
    setIssued({ label: result.label, key: result.key }); setLabel("");
  });

  const origin = window.location.origin;
  return (
    <Space direction="vertical" size={12} className="admin-full-width">
      <Alert
        type="info"
        showIcon
        className="admin-alert-inline"
        message="让业务系统接入这个连接器"
        description={<>
          生成接入密钥后，交给业务系统管理员，在业务系统的 Bailey 设置里填写 <Typography.Text code>{origin}</Typography.Text> 和这个密钥即可。
          业务系统主机上需已安装 agent-host（见文档「接入新应用」）。密钥只用于注册主机，撤销后已连接的主机不受影响；要断开主机，请在下方「已连接的主机」中断开。
        </>}
      />
      {errorText ? <Alert type="error" showIcon message={errorText} /> : null}
      {issued ? (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setIssued(null)}
          message={`已生成接入密钥「${issued.label}」，只显示这一次，请立即复制`}
          description={<Typography.Paragraph copyable={{ text: issued.key }} code style={{ marginBottom: 0, wordBreak: "break-all" }}>{issued.key}</Typography.Paragraph>}
        />
      ) : null}

      <Card size="small" title="接入密钥" className="antd-admin-card">
        {props.canWrite !== false ? (
          <Space.Compact style={{ width: "100%", maxWidth: 520, marginBottom: 12 }}>
            <Input value={label} maxLength={120} placeholder="用途，例如：网优助手-测试服务器" onChange={(event) => setLabel(event.target.value)} onPressEnter={() => label.trim() && void createKey()} />
            <Button type="primary" loading={busy} disabled={!label.trim()} onClick={() => void createKey()}>生成接入密钥</Button>
          </Space.Compact>
        ) : null}
        <Table<HostKey>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.keys ?? []}
          locale={{ emptyText: <Empty description="还没有接入密钥" /> }}
          columns={[
            { title: "用途", dataIndex: "label" },
            { title: "密钥", dataIndex: "prefix", render: (prefix: string) => <Typography.Text code>{prefix}…</Typography.Text> },
            { title: "创建时间", dataIndex: "created_at", render: time },
            { title: "最近使用", dataIndex: "last_used_at", render: time },
            { title: "状态", dataIndex: "revoked_at", render: (revoked: string | null) => (revoked ? <Tag>已撤销</Tag> : <Tag color="success">有效</Tag>) },
            {
              title: "",
              key: "actions",
              render: (_: unknown, key: HostKey) => key.revoked_at || props.canWrite === false ? null : (
                <Popconfirm title="撤销后这个密钥不能再注册新主机，已连接的主机不受影响。" okText="撤销" cancelText="取消"
                  onConfirm={() => run(() => api(`${base(props.instanceId)}/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" }))}>
                  <Button size="small" danger disabled={busy}>撤销</Button>
                </Popconfirm>
              )
            }
          ]}
        />
      </Card>

      <Card size="small" title="已连接的主机" className="antd-admin-card">
        <Table<HostDevice>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.devices ?? []}
          locale={{ emptyText: <Empty description="还没有主机连接" /> }}
          columns={[
            { title: "主机", dataIndex: "name" },
            { title: "状态", dataIndex: "online", render: (online: boolean) => (online ? <Tag color="success">在线</Tag> : <Tag>离线</Tag>) },
            { title: "版本", dataIndex: "client_version", render: (value: string | null) => value || "—" },
            { title: "最近在线", dataIndex: "last_seen_at", render: time },
            { title: "注册时间", dataIndex: "created_at", render: time },
            {
              title: "",
              key: "actions",
              render: (_: unknown, device: HostDevice) => props.canWrite === false ? null : (
                <Popconfirm title="断开后这台主机立即失去连接，需要重新填写接入密钥才能再连接。" okText="断开" cancelText="取消"
                  onConfirm={() => run(() => api(`${base(props.instanceId)}/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" }))}>
                  <Button size="small" danger disabled={busy}>断开</Button>
                </Popconfirm>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
