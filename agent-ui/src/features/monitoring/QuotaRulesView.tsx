import { FormEvent, useEffect, useState } from "react";

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
    <section className="admin-card monitoring-card">
      <div className="monitoring-heading">
        <div>
          <h2>配额规则</h2>
          <p>支持平台和部门级软阻断，不影响已经运行中的会话。</p>
        </div>
      </div>
      <form className="monitoring-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">作用域类型</span>
          <select className="field-input" value={scopeType} onChange={(event) => setScopeType(event.target.value as typeof scopeType)}>
            <option value="department">部门</option>
            <option value="platform">平台</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">{scopeType === "platform" ? "平台范围" : "部门范围"}</span>
          <input
            className="field-input"
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
            placeholder={scopeType === "platform" ? "platform" : "dept-rd"}
          />
        </label>
        <label className="field">
          <span className="field-label">功能维度</span>
          <input className="field-input" value={featureType} onChange={(event) => setFeatureType(event.target.value)} />
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
        </label>
        <label className="field">
          <span className="field-label">阈值</span>
          <input className="field-input" value={thresholdValue} onChange={(event) => setThresholdValue(event.target.value)} />
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
        </label>
        <button className="monitoring-action-btn" type="submit" disabled={saving}>
          {saving ? "保存中..." : "保存配额规则"}
        </button>
      </form>
      {loading ? <p>加载中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {message ? <p className="monitoring-success">{message}</p> : null}
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
                <td>{policy.isActive ? "启用" : "停用"}</td>
                <td>
                  <button type="button" className="monitoring-link-btn" onClick={() => void togglePolicy(policy)}>
                    {policy.isActive ? "停用" : "启用"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
