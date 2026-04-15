import { FormEvent, useEffect, useState } from "react";
import { Alert, Button, Card, Spin, Tag, Typography } from "antd";

import { createCostProfile, fetchCostProfiles, updateCostProfile } from "./api";
import type { CostProfileRecord } from "./types";

export function CostProfilesView() {
  const [costProfiles, setCostProfiles] = useState<CostProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [model, setModel] = useState("gpt-5.4");
  const [inputTokenPrice, setInputTokenPrice] = useState("2.500000");
  const [cachedInputTokenPrice, setCachedInputTokenPrice] = useState("0.250000");
  const [outputTokenPrice, setOutputTokenPrice] = useState("15.000000");
  const [internalCostMultiplier, setInternalCostMultiplier] = useState("1.0000");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setErrorText("");
    try {
      const next = await fetchCostProfiles();
      setCostProfiles(next.costProfiles);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载模型定价失败");
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
      await createCostProfile({
        model,
        inputTokenPrice,
        cachedInputTokenPrice,
        outputTokenPrice,
        internalCostMultiplier
      });
      setMessage("模型定价已保存");
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存模型定价失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleProfile(profile: CostProfileRecord) {
    setErrorText("");
    try {
      await updateCostProfile(profile.id, { isActive: !profile.isActive });
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新模型定价失败");
    }
  }

  return (
    <Card className="admin-card monitoring-card antd-admin-card">
      <div className="monitoring-heading">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            模型定价
          </Typography.Title>
          <Typography.Paragraph>按每 1M tokens 配置输入、缓存输入、输出价格和内部成本系数。</Typography.Paragraph>
        </div>
      </div>
      <form className="monitoring-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">模型</span>
          <input className="field-input" value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">输入 / 1M tokens</span>
          <input className="field-input" value={inputTokenPrice} onChange={(event) => setInputTokenPrice(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">缓存输入 / 1M tokens</span>
          <input
            className="field-input"
            value={cachedInputTokenPrice}
            onChange={(event) => setCachedInputTokenPrice(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">输出 / 1M tokens</span>
          <input className="field-input" value={outputTokenPrice} onChange={(event) => setOutputTokenPrice(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">内部系数</span>
          <input
            className="field-input"
            value={internalCostMultiplier}
            onChange={(event) => setInternalCostMultiplier(event.target.value)}
          />
        </label>
        <Button className="monitoring-action-btn" type="primary" htmlType="submit" aria-label="保存模型定价" loading={saving}>
          {saving ? "保存中..." : "保存模型定价"}
        </Button>
      </form>
      {loading ? <Spin size="small" /> : null}
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {message ? <p className="monitoring-success">{message}</p> : null}
      <div className="monitoring-table-wrap">
        <table className="monitoring-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>输入 / 1M</th>
              <th>缓存 / 1M</th>
              <th>输出 / 1M</th>
              <th>内部系数</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {costProfiles.map((profile) => (
              <tr key={profile.id}>
                <td>{profile.model}</td>
                <td>{profile.inputTokenPrice}</td>
                <td>{profile.cachedInputTokenPrice}</td>
                <td>{profile.outputTokenPrice}</td>
                <td>{profile.internalCostMultiplier}</td>
                <td>
                  <Tag color={profile.isActive ? "success" : "default"}>{profile.isActive ? "启用" : "停用"}</Tag>
                </td>
                <td>
                  <Button
                    type="link"
                    className="monitoring-link-btn"
                    aria-label={profile.isActive ? "停用" : "启用"}
                    onClick={() => void toggleProfile(profile)}
                  >
                    {profile.isActive ? "停用" : "启用"}
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
