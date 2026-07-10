import { FormEvent, useEffect, useState } from "react";
import { Alert, Button, Card, Spin, Tag, Typography } from "antd";

import { formatUsdAmount } from "../../lib/formatters";
import { MODEL_OPTIONS } from "../../lib/model-config";
import { createCostProfile, fetchCostProfiles, updateCostProfile } from "./api";
import type { CostProfileRecord } from "./types";

type CostProfilePreset = {
  key: string;
  label: string;
  model: string;
  inputTokenPrice: string;
  cachedInputTokenPrice: string;
  cacheWriteTokenPrice: string;
  outputTokenPrice: string;
  longContextThresholdTokens: string;
  longContextInputMultiplier: string;
  longContextOutputMultiplier: string;
  internalCostMultiplier: string;
};

const CUSTOM_PRESET_KEY = "custom";
const COST_PROFILE_PRESETS: CostProfilePreset[] = [
  {
    key: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    model: "gpt-5.6-sol",
    inputTokenPrice: "5.000000",
    cachedInputTokenPrice: "0.500000",
    cacheWriteTokenPrice: "6.250000",
    outputTokenPrice: "30.000000",
    longContextThresholdTokens: "272000",
    longContextInputMultiplier: "2.0000",
    longContextOutputMultiplier: "1.5000",
    internalCostMultiplier: "1.0000"
  },
  {
    key: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    model: "gpt-5.6-terra",
    inputTokenPrice: "2.500000",
    cachedInputTokenPrice: "0.250000",
    cacheWriteTokenPrice: "3.125000",
    outputTokenPrice: "15.000000",
    longContextThresholdTokens: "272000",
    longContextInputMultiplier: "2.0000",
    longContextOutputMultiplier: "1.5000",
    internalCostMultiplier: "1.0000"
  },
  {
    key: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    model: "gpt-5.6-luna",
    inputTokenPrice: "1.000000",
    cachedInputTokenPrice: "0.100000",
    cacheWriteTokenPrice: "1.250000",
    outputTokenPrice: "6.000000",
    longContextThresholdTokens: "272000",
    longContextInputMultiplier: "2.0000",
    longContextOutputMultiplier: "1.5000",
    internalCostMultiplier: "1.0000"
  },
  {
    key: "gpt-5.5",
    label: "GPT-5.5",
    model: "gpt-5.5",
    inputTokenPrice: "5.000000",
    cachedInputTokenPrice: "0.500000",
    cacheWriteTokenPrice: "0.000000",
    outputTokenPrice: "30.000000",
    longContextThresholdTokens: "272000",
    longContextInputMultiplier: "2.0000",
    longContextOutputMultiplier: "1.5000",
    internalCostMultiplier: "1.0000"
  },
  {
    key: "gpt-5.4",
    label: "GPT-5.4",
    model: "gpt-5.4",
    inputTokenPrice: "2.500000",
    cachedInputTokenPrice: "0.250000",
    cacheWriteTokenPrice: "0.000000",
    outputTokenPrice: "15.000000",
    longContextThresholdTokens: "272000",
    longContextInputMultiplier: "2.0000",
    longContextOutputMultiplier: "1.5000",
    internalCostMultiplier: "1.0000"
  },
  {
    key: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    model: "gpt-5.4-mini",
    inputTokenPrice: "0.750000",
    cachedInputTokenPrice: "0.075000",
    cacheWriteTokenPrice: "0.000000",
    outputTokenPrice: "4.500000",
    longContextThresholdTokens: "",
    longContextInputMultiplier: "1.0000",
    longContextOutputMultiplier: "1.0000",
    internalCostMultiplier: "1.0000"
  }
];

const DEFAULT_COST_PROFILE_PRESET = COST_PROFILE_PRESETS.find((preset) => preset.key === "gpt-5.5")!;
const COST_PROFILE_PRESET_MAP = new Map(COST_PROFILE_PRESETS.map((preset) => [preset.key, preset]));

export function CostProfilesView() {
  const [costProfiles, setCostProfiles] = useState<CostProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [presetKey, setPresetKey] = useState(DEFAULT_COST_PROFILE_PRESET.key);
  const [model, setModel] = useState(DEFAULT_COST_PROFILE_PRESET.model);
  const [inputTokenPrice, setInputTokenPrice] = useState(DEFAULT_COST_PROFILE_PRESET.inputTokenPrice);
  const [cachedInputTokenPrice, setCachedInputTokenPrice] = useState(DEFAULT_COST_PROFILE_PRESET.cachedInputTokenPrice);
  const [cacheWriteTokenPrice, setCacheWriteTokenPrice] = useState(DEFAULT_COST_PROFILE_PRESET.cacheWriteTokenPrice);
  const [outputTokenPrice, setOutputTokenPrice] = useState(DEFAULT_COST_PROFILE_PRESET.outputTokenPrice);
  const [longContextThresholdTokens, setLongContextThresholdTokens] = useState(DEFAULT_COST_PROFILE_PRESET.longContextThresholdTokens);
  const [longContextInputMultiplier, setLongContextInputMultiplier] = useState(DEFAULT_COST_PROFILE_PRESET.longContextInputMultiplier);
  const [longContextOutputMultiplier, setLongContextOutputMultiplier] = useState(DEFAULT_COST_PROFILE_PRESET.longContextOutputMultiplier);
  const [internalCostMultiplier, setInternalCostMultiplier] = useState(DEFAULT_COST_PROFILE_PRESET.internalCostMultiplier);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const suggestedModels = Array.from(new Set([...MODEL_OPTIONS.map((option) => option.value), ...costProfiles.map((profile) => profile.model)])).sort(
    (left, right) => left.localeCompare(right)
  );

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

  function applyPreset(preset: CostProfilePreset) {
    setPresetKey(preset.key);
    setModel(preset.model);
    setInputTokenPrice(preset.inputTokenPrice);
    setCachedInputTokenPrice(preset.cachedInputTokenPrice);
    setCacheWriteTokenPrice(preset.cacheWriteTokenPrice);
    setOutputTokenPrice(preset.outputTokenPrice);
    setLongContextThresholdTokens(preset.longContextThresholdTokens);
    setLongContextInputMultiplier(preset.longContextInputMultiplier);
    setLongContextOutputMultiplier(preset.longContextOutputMultiplier);
    setInternalCostMultiplier(preset.internalCostMultiplier);
  }

  function handlePresetChange(nextPresetKey: string) {
    setMessage("");
    if (nextPresetKey === CUSTOM_PRESET_KEY) {
      setPresetKey(CUSTOM_PRESET_KEY);
      return;
    }
    const preset = COST_PROFILE_PRESET_MAP.get(nextPresetKey);
    if (!preset) return;
    applyPreset(preset);
  }

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
        cacheWriteTokenPrice,
        outputTokenPrice,
        longContextThresholdTokens: longContextThresholdTokens || undefined,
        longContextInputMultiplier,
        longContextOutputMultiplier,
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
          <Typography.Paragraph>按每 1M tokens 配置输入、缓存读取、缓存写入和输出价格，金额单位为美元 USD。</Typography.Paragraph>
        </div>
      </div>
      <form className="monitoring-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">价格预设</span>
          <select
            className="field-input"
            aria-label="价格预设"
            value={presetKey}
            onChange={(event) => handlePresetChange(event.target.value)}
          >
            {COST_PROFILE_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
            <option value={CUSTOM_PRESET_KEY}>自定义</option>
          </select>
          <small className="field-help">
            选择官方预设会自动带出价格；切到自定义后可录入任意模型，手工修改价格时也会自动切换到自定义。
          </small>
        </label>
        <label className="field">
          <span className="field-label">模型</span>
          <input
            className="field-input"
            aria-label="模型"
            list="cost-profile-model-options"
            value={model}
            onChange={(event) => {
              setPresetKey(CUSTOM_PRESET_KEY);
              setModel(event.target.value);
            }}
          />
          <small className="field-help">支持现有模型建议，也支持直接录入自定义模型标识。</small>
        </label>
        <label className="field">
          <span className="field-label">输入 / 1M tokens (USD)</span>
          <input
            className="field-input"
            aria-label="输入 / 1M tokens (USD)"
            value={inputTokenPrice}
            onChange={(event) => {
              setPresetKey(CUSTOM_PRESET_KEY);
              setInputTokenPrice(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">缓存输入 / 1M tokens (USD)</span>
          <input
            className="field-input"
            aria-label="缓存输入 / 1M tokens (USD)"
            value={cachedInputTokenPrice}
            onChange={(event) => {
              setPresetKey(CUSTOM_PRESET_KEY);
              setCachedInputTokenPrice(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">缓存写入 / 1M tokens (USD)</span>
          <input
            className="field-input"
            aria-label="缓存写入 / 1M tokens (USD)"
            value={cacheWriteTokenPrice}
            onChange={(event) => {
              setPresetKey(CUSTOM_PRESET_KEY);
              setCacheWriteTokenPrice(event.target.value);
            }}
          />
          <small className="field-help">上游未返回缓存写入 token 时，系统会把该次费用标记为部分估算。</small>
        </label>
        <label className="field">
          <span className="field-label">输出 / 1M tokens (USD)</span>
          <input
            className="field-input"
            aria-label="输出 / 1M tokens (USD)"
            value={outputTokenPrice}
            onChange={(event) => {
              setPresetKey(CUSTOM_PRESET_KEY);
              setOutputTokenPrice(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">内部系数</span>
          <input
            className="field-input"
            aria-label="内部系数"
            value={internalCostMultiplier}
            onChange={(event) => {
              setPresetKey(CUSTOM_PRESET_KEY);
              setInternalCostMultiplier(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">长上下文阈值 (tokens)</span>
          <input
            className="field-input"
            aria-label="长上下文阈值 (tokens)"
            value={longContextThresholdTokens}
            placeholder="留空表示不启用"
            onChange={(event) => {
              setPresetKey(CUSTOM_PRESET_KEY);
              setLongContextThresholdTokens(event.target.value);
            }}
          />
          <small className="field-help">仅当单次输入超过此阈值时应用下面的输入和输出倍率。</small>
        </label>
        <label className="field">
          <span className="field-label">长上下文输入倍率</span>
          <input
            className="field-input"
            aria-label="长上下文输入倍率"
            value={longContextInputMultiplier}
            onChange={(event) => {
              setPresetKey(CUSTOM_PRESET_KEY);
              setLongContextInputMultiplier(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">长上下文输出倍率</span>
          <input
            className="field-input"
            aria-label="长上下文输出倍率"
            value={longContextOutputMultiplier}
            onChange={(event) => {
              setPresetKey(CUSTOM_PRESET_KEY);
              setLongContextOutputMultiplier(event.target.value);
            }}
          />
        </label>
        <Button className="monitoring-action-btn" type="primary" htmlType="submit" aria-label="保存模型定价" loading={saving}>
          {saving ? "保存中..." : "保存模型定价"}
        </Button>
      </form>
      <datalist id="cost-profile-model-options">
        {suggestedModels.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      {loading ? <Spin size="small" /> : null}
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {message ? <Alert type="success" showIcon className="admin-alert-inline" message={message} /> : null}
      <div className="monitoring-table-wrap">
        <table className="monitoring-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>输入 / 1M (USD)</th>
              <th>缓存 / 1M (USD)</th>
              <th>缓存写入 / 1M (USD)</th>
              <th>输出 / 1M (USD)</th>
              <th>长上下文规则</th>
              <th>内部系数</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {costProfiles.map((profile) => (
              <tr key={profile.id}>
                <td>{profile.model}</td>
                <td>{formatUsdAmount(profile.inputTokenPrice)}</td>
                <td>{formatUsdAmount(profile.cachedInputTokenPrice)}</td>
                <td>{formatUsdAmount(profile.cacheWriteTokenPrice)}</td>
                <td>{formatUsdAmount(profile.outputTokenPrice)}</td>
                <td>
                  {profile.longContextThresholdTokens
                    ? `>${profile.longContextThresholdTokens.toLocaleString()} · 输入 ${profile.longContextInputMultiplier ?? "1.0000"}x · 输出 ${profile.longContextOutputMultiplier ?? "1.0000"}x`
                    : "—"}
                </td>
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
