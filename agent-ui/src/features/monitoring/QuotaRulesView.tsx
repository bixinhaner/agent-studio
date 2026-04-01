import { FormEvent, useEffect, useState } from "react";
import { Alert, Button, Card, Spin, Tag, Typography } from "antd";

import { createQuotaPolicy, fetchQuotaPolicies, updateQuotaPolicy } from "./api";
import type { QuotaPolicyRecord } from "./types";

function formatCount(value: string): string {
  return value;
}

function getScopeIdInput(scopeType: "platform" | "department", scopeId: string): string {
  if (scopeType === "platform") return "platform";
  return scopeId.trim() || "dept-rd";
}

export function QuotaRulesView() {
  const [policies, setPolicies] = useState<QuotaPolicyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [scopeType, setScopeType] = useState<"platform" | "department">("department");
  const [scopeId, setScopeId] = useState("dept-rd");
  const [featureType, setFeatureType] = useState("chat");
  const [metricType, setMetricType] = useState<QuotaPolicyRecord["metricType"]>("internal_cost");
  const [thresholdValue, setThresholdValue] = useState("100");
  const [enforcementMode, setEnforcementMode] = useState<QuotaPolicyRecord["enforcementMode"]>("soft_block");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setErrorText("");
    try {
      const next = await fetchQuotaPolicies();
      setPolicies(next.quotaPolicies);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载配额规则失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrorText("");
    setMessage("");
    try {
      await createQuotaPolicy({
        scopeType,
        scopeId: getScopeIdInput(scopeType, scopeId),
        featureType,
        metricType,
        thresholdValue,
        enforcementMode
      });
      setMessage("配额规则已保存");
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存配额规则失败");
    } finally {
      setSaving(false);
    }
  }

  async function togglePolicy(policy: QuotaPolicyRecord) {
    setErrorText("");
    try {
      await updateQuotaPolicy(policy.id, {
        isActive: !policy.isActive
      });
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新配额规则失败");
    }
  }

  return (
    <Card className="admin-card monitoring-card antd-admin-card">
      <div className="monitoring-heading">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            配额规则
          </Typography.Title>
          <Typography.Paragraph>支持平台和部门级软阻断，不影响已经运行中的会话。</Typography.Paragraph>
        </div>
      </div>
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {message ? <Alert type="success" showIcon className="admin-alert-inline" message={message} /> : null}
      <form className="monitoring-form" onSubmit={handleSubmit}>
        <div className="monitoring-form-span-full admin-form-inline-section-head">
          <h4>范围配置</h4>
          <p>先确定规则覆盖范围，再决定限制阈值。</p>
        </div>
        <label className="field">
          <span className="field-label">作用域类型</span>
          <select
            className="field-input"
            aria-label="作用域类型"
            value={scopeType}
            onChange={(event) => setScopeType(event.target.value as typeof scopeType)}
          >
            <option value="department">部门</option>
            <option value="platform">平台</option>
          </select>
          <small className="field-help">平台规则用于全局预算；部门规则用于精细治理。</small>
        </label>
        <label className="field">
          <span className="field-label">{scopeType === "platform" ? "平台范围" : "部门范围"}</span>
          <input
            className="field-input"
            aria-label={scopeType === "platform" ? "平台范围" : "部门范围"}
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
            placeholder={scopeType === "platform" ? "platform" : "dept-rd"}
          />
          <small className="field-help">建议保持与组织同步中的部门 External ID 一致。</small>
        </label>
        <label className="field">
          <span className="field-label">功能维度</span>
          <input className="field-input" value={featureType} onChange={(event) => setFeatureType(event.target.value)} />
          <small className="field-help">如 `chat`、`agent_run`，用于按功能拆分额度。</small>
        </label>
        <label className="field">
          <span className="field-label">计量方式</span>
          <select
            className="field-input"
            value={metricType}
            onChange={(event) => setMetricType(event.target.value as QuotaPolicyRecord["metricType"])}
          >
            <option value="internal_cost">internal_cost</option>
            <option value="estimated_cost">estimated_cost</option>
            <option value="total_tokens">total_tokens</option>
            <option value="request_count">request_count</option>
          </select>
          <small className="field-help">建议优先使用 `internal_cost`，与成本看板口径一致。</small>
        </label>
        <div className="monitoring-form-span-full admin-form-inline-section-head">
          <h4>策略配置</h4>
          <p>设置阈值和执行方式，控制到达阈值后的行为。</p>
        </div>
        <label className="field">
          <span className="field-label">阈值</span>
          <input className="field-input" aria-label="阈值" value={thresholdValue} onChange={(event) => setThresholdValue(event.target.value)} />
          <small className="field-help">建议先使用较保守阈值并观察一周波动。</small>
        </label>
        <label className="field">
          <span className="field-label">执行方式</span>
          <select
            className="field-input"
            value={enforcementMode}
            onChange={(event) => setEnforcementMode(event.target.value as QuotaPolicyRecord["enforcementMode"])}
          >
            <option value="soft_block">soft_block</option>
            <option value="alert_only">alert_only</option>
          </select>
          <small className="field-help">`soft_block` 会限制继续调用，`alert_only` 仅告警。</small>
        </label>
        <Button className="monitoring-action-btn" type="primary" htmlType="submit" aria-label="保存配额规则" loading={saving}>
          {saving ? "保存中..." : "保存配额规则"}
        </Button>
      </form>
      {loading ? <Spin size="small" /> : null}
      <div className="monitoring-table-wrap">
        <table className="monitoring-table">
          <thead>
            <tr>
              <th>作用域</th>
              <th>功能</th>
              <th>计量</th>
              <th>阈值</th>
              <th>执行方式</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.id}>
                <td>
                  {policy.scopeType} / {policy.scopeId}
                </td>
                <td>{policy.featureType ?? "—"}</td>
                <td>{policy.metricType}</td>
                <td>{formatCount(policy.thresholdValue)}</td>
                <td>{policy.enforcementMode}</td>
                <td>
                  <Tag color={policy.isActive ? "success" : "default"}>{policy.isActive ? "启用" : "停用"}</Tag>
                </td>
                <td>
                  <Button
                    type="link"
                    className="monitoring-link-btn"
                    aria-label={policy.isActive ? "停用" : "启用"}
                    onClick={() => void togglePolicy(policy)}
                  >
                    {policy.isActive ? "停用" : "启用"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
