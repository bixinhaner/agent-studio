import { useEffect, useState } from "react";
import { Alert, Button, Form, Radio, Select } from "antd";
import { fetchAdminUsers } from "../admin/api";
import type { SystemSettingsFieldErrors, SystemSettingsLocalBridgeVisibility } from "./types";

export function LocalBridgeVisibilitySettingsView({ value, fieldErrors, disabled, onChange }: {
  value: SystemSettingsLocalBridgeVisibility;
  fieldErrors: SystemSettingsFieldErrors;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsLocalBridgeVisibility>): void;
}) {
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setFailed(false);
    void fetchAdminUsers().then(result => {
      if (!alive) return;
      const users = result.users.filter(user => user.effective.status === "active" && user.synced.email);
      setOptions([...new Map(users.map(user => {
        const email = user.synced.email!.trim().toLowerCase();
        return [email, { value: email, label: `${user.synced.displayName || email} · ${email}` }] as const;
      })).values()]);
    }).catch(() => { if (alive) setFailed(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision]);
  const emailErrors = Object.entries(fieldErrors).filter(([key]) => key.startsWith("localBridgeVisibility.emails")).map(([, message]) => message);
  return <section className="resource-center-section">
    <div className="resource-center-section-header"><div>
      <h3>本机文件夹入口</h3>
      <p>控制哪些用户能在 Portal 看到“使用电脑文件夹”和“我的电脑”。</p>
    </div></div>
    <Form layout="vertical" style={{ maxWidth: 680 }}>
      <Form.Item label="入口可见范围" validateStatus={fieldErrors["localBridgeVisibility.mode"] ? "error" : undefined} help={fieldErrors["localBridgeVisibility.mode"]}>
        <Radio.Group value={value.mode} disabled={disabled} onChange={event => onChange({ mode: event.target.value })} options={[
          { label: "不显示", value: "hidden" }, { label: "指定用户", value: "selected" }, { label: "所有用户", value: "all" }
        ]} />
      </Form.Item>
      {value.mode === "selected" ? <>
        {failed ? <Alert type="warning" showIcon message="用户列表暂时无法加载，仍可直接填写登录邮箱。" action={<Button size="small" onClick={() => setRevision(old => old + 1)}>重试</Button>} style={{ marginBottom: 16 }} /> : null}
        <Form.Item label="可见用户" htmlFor="local-bridge-visible-users" validateStatus={emailErrors.length ? "error" : undefined} help={emailErrors.length ? emailErrors.join("；") : undefined} extra="按姓名或邮箱搜索，也可以输入登录邮箱后按回车。名单为空时，所有用户均不显示入口。">
          <Select id="local-bridge-visible-users" mode="tags" value={value.emails} options={options} loading={loading} disabled={disabled} optionFilterProp="label" tokenSeparators={[",", ";", "，", "；", " ", "\n"]} placeholder="搜索用户或填写登录邮箱" style={{ width: "100%" }} onChange={emails => onChange({ emails: [...new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))] })} />
        </Form.Item>
      </> : null}
      <p style={{ color: "var(--admin-color-subtle)" }}>点击“应用并发布”后生效，无需重新部署。用户刷新 Portal 或回到页面时会更新入口。</p>
      <p style={{ color: "var(--admin-color-subtle)" }}>这里只控制界面展示，已有连接、任务绑定和后端执行权限保持不变。</p>
    </Form>
  </section>;
}
