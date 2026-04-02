import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Collapse, Input, Segmented, Select, Space, Tag } from "antd";

import { fetchAgentModes } from "../capability-center/api";
import type { AgentModeRecord } from "../capability-center/types";
import { fetchKnowledgeSets } from "../resources-center/api";
import type { KnowledgeSetRecord } from "../resources-center/types";
import { updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { ExternalApiUsageView } from "./ExternalApiUsageView";
import type { IntegrationDetail, OpenAICompatibleApiConfigDraft } from "./types";

type ExternalTab = "basic" | "usage";

const TABS: Array<{ id: ExternalTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "usage", label: "API调用记录" }
];

const STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" },
  { label: "draft", value: "draft" }
];

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const normalized = typeof item === "string" ? item.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function buildDraft(detail: IntegrationDetail): OpenAICompatibleApiConfigDraft {
  return {
    agentModeId: asString(detail.config.agentModeId) || asString(detail.config.defaultAgentModeId),
    knowledgeSetIds:
      asStringArray(detail.config.knowledgeSetIds).length > 0
        ? asStringArray(detail.config.knowledgeSetIds)
        : asStringArray(detail.config.defaultKnowledgeSetIds),
    apiKeyDraft: ""
  };
}

function optionsWithCurrent(options: Array<{ label: string; value: string }>, value: string) {
  if (!value) return options;
  if (options.some((item) => item.value === value)) return options;
  return [{ label: value, value }, ...options];
}

function buildCurlExample(baseUrl: string, draft: OpenAICompatibleApiConfigDraft): string {
  const apiKey = draft.apiKeyDraft.trim() || "<api-key>";

  return [
    `curl ${baseUrl}/chat/completions \\`,
    `  -H "Authorization: Bearer ${apiKey}" \\`,
    `  -H "Content-Type: application/json" \\`,
    "  -d '{",
    '    "messages": [',
    '      { "role": "user", "content": "请基于已配置的资料范围回答当前问题。" }',
    "    ]",
    "  }'"
  ].join("\n");
}

function generateApiKeyDraft() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `as-${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `as-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function OpenAICompatibleApiIntegrationView(props: {
  detail: IntegrationDetail;
  onUpdated(detail: IntegrationDetail): void;
}) {
  const [activeTab, setActiveTab] = useState<ExternalTab>("basic");
  const [name, setName] = useState(props.detail.instance.name);
  const [description, setDescription] = useState(props.detail.instance.description || "");
  const [status, setStatus] = useState(props.detail.instance.status);
  const [draft, setDraft] = useState<OpenAICompatibleApiConfigDraft>(() => buildDraft(props.detail));
  const [agentModes, setAgentModes] = useState<AgentModeRecord[]>([]);
  const [knowledgeSets, setKnowledgeSets] = useState<KnowledgeSetRecord[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsErrorText, setOptionsErrorText] = useState("");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    setActiveTab("basic");
    setName(props.detail.instance.name);
    setDescription(props.detail.instance.description || "");
    setStatus(props.detail.instance.status);
    setDraft(buildDraft(props.detail));
    setErrorText("");
    setSuccessText("");
  }, [props.detail]);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setOptionsLoading(true);
      setOptionsErrorText("");
      try {
        const [modeResponse, knowledgeSetResponse] = await Promise.all([fetchAgentModes(), fetchKnowledgeSets()]);
        if (!active) return;
        setAgentModes(modeResponse.agentModes.filter((item) => item.status === "active"));
        setKnowledgeSets(
          knowledgeSetResponse.knowledgeSets.filter((item) => item.status === "active" && item.sourceType === "managed_upload")
        );
      } catch (error) {
        if (!active) return;
        setOptionsErrorText(error instanceof Error ? error.message : "加载 Agent Mode/资料集列表失败");
      } finally {
        if (active) setOptionsLoading(false);
      }
    }

    void loadOptions();
    return () => {
      active = false;
    };
  }, []);

  const apiBaseUrl = useMemo(
    () => (typeof window === "undefined" ? "/openai/v1" : `${window.location.origin}/openai/v1`),
    []
  );

  const agentModeOptions = useMemo(
    () => agentModes.map((item) => ({ label: `${item.name} (${item.slug})`, value: item.id })),
    [agentModes]
  );
  const knowledgeSetOptions = useMemo(
    () => knowledgeSets.map((item) => ({ label: `${item.name} (${item.slug})`, value: item.id })),
    [knowledgeSets]
  );

  async function handleSave() {
    if (!name.trim()) {
      setErrorText("请填写实例名称");
      return;
    }
    if (!draft.agentModeId.trim()) {
      setErrorText("请配置绑定的 Agent Mode");
      return;
    }

    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const detail = await updateIntegrationInstance(props.detail.instance.id, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        config: {
          agentModeId: draft.agentModeId.trim(),
          knowledgeSetIds: asStringArray(draft.knowledgeSetIds)
        },
        secretState: draft.apiKeyDraft.trim()
          ? {
              apiKey: draft.apiKeyDraft.trim()
            }
          : undefined
      });
      props.onUpdated(detail);
      setSuccessText("外部 OpenAI API 配置已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存外部 OpenAI API 配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setErrorText("");
    setSuccessText("");
    try {
      const result = await validateIntegrationInstance(props.detail.instance.id);
      props.onUpdated(result.detail);
      setSuccessText("外部 OpenAI API 配置校验完成");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "校验外部 OpenAI API 配置失败");
    } finally {
      setValidating(false);
    }
  }

  return (
    <section className="resource-center-detail-stack">
      <Card className="resource-center-section capability-center-summary antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{props.detail.instance.name}</h3>
            <p>给第三方应用提供 OpenAI Chat Completions 兼容入口，Agent Mode 与资料集范围固定在管理端。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="外部 OpenAI API 详情标签">
          <Segmented
            block
            value={activeTab}
            options={TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
            onChange={(value) => setActiveTab(value as ExternalTab)}
          />
        </div>

        {optionsErrorText ? <Alert type="warning" showIcon className="admin-alert-inline" message={optionsErrorText} /> : null}
        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        {activeTab === "basic" ? (
          <>
            <Collapse
              size="small"
              defaultActiveKey={["identity", "security", "scope", "docs"]}
              items={[
                {
                  key: "identity",
                  label: "基础信息",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field">
                        <span className="field-label">实例名称</span>
                        <Input value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
                      </label>
                      <label className="field">
                        <span className="field-label">实例 slug</span>
                        <Input value={props.detail.instance.slug} disabled />
                      </label>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">实例描述</span>
                        <Input.TextArea
                          rows={4}
                          value={description}
                          disabled={saving}
                          onChange={(event) => setDescription(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">状态</span>
                        <Select value={status} options={STATUS_OPTIONS} disabled={saving} onChange={(value) => setStatus(value)} />
                      </label>
                      <div className="field">
                        <span className="field-label">Base URL</span>
                        <p className="resource-center-subtle">{apiBaseUrl}</p>
                      </div>
                    </div>
                  )
                },
                {
                  key: "security",
                  label: "接口密钥",
                  children: (
                    <div className="resource-center-form-grid">
                      <div className="field resource-center-form-span-2">
                        <span className="field-label">当前密钥状态</span>
                        <p className="resource-center-subtle">
                          {props.detail.secretState.hasSecrets ? "已保存 API Key，可继续复用。" : "尚未保存 API Key。"}
                        </p>
                      </div>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">API Key</span>
                        <Space.Compact block>
                          <Input.Password
                            value={draft.apiKeyDraft}
                            placeholder="留空则保持现状"
                            disabled={saving}
                            onChange={(event) => setDraft((current) => ({ ...current, apiKeyDraft: event.target.value }))}
                          />
                          <Button onClick={() => setDraft((current) => ({ ...current, apiKeyDraft: generateApiKeyDraft() }))} disabled={saving}>
                            生成
                          </Button>
                        </Space.Compact>
                      </label>
                    </div>
                  )
                },
                {
                  key: "scope",
                  label: "运行范围",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field">
                        <span className="field-label">绑定 Agent Mode</span>
                        <Select
                          showSearch
                          value={draft.agentModeId || undefined}
                          options={optionsWithCurrent(agentModeOptions, draft.agentModeId)}
                          loading={optionsLoading}
                          disabled={saving}
                          optionFilterProp="label"
                          onChange={(value) => setDraft((current) => ({ ...current, agentModeId: value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">绑定资料集</span>
                        <Select
                          mode="multiple"
                          showSearch
                          value={draft.knowledgeSetIds}
                          options={knowledgeSetOptions}
                          loading={optionsLoading}
                          disabled={saving}
                          optionFilterProp="label"
                          onChange={(value) => setDraft((current) => ({ ...current, knowledgeSetIds: value }))}
                        />
                      </label>
                      <div className="field resource-center-form-span-2">
                        <span className="field-label">调用说明</span>
                        <p className="resource-center-subtle">
                          外部调用方只需要 Base URL 和 API Key。实际使用的模型、推理强度、沙箱与联网策略都继承自绑定 Agent Mode 的 Run Profile。
                        </p>
                      </div>
                    </div>
                  )
                },
                {
                  key: "docs",
                  label: "接入说明",
                  children: (
                    <div className="resource-center-form-grid">
                      <div className="field resource-center-form-span-2">
                        <span className="field-label">兼容路径</span>
                        <p className="resource-center-subtle">
                          当前实现提供 `GET /models` 与 `POST /chat/completions`。
                        </p>
                      </div>
                      <div className="field resource-center-form-span-2">
                        <span className="field-label">请求约定</span>
                        <p className="resource-center-subtle">
                          外部调用方不需要传 Agent Mode 或资料集参数。若第三方 SDK 强制要求 `model`，可传 `/models` 返回值；服务端实际仍按绑定 Agent Mode 的默认运行参数执行，不接受请求侧覆盖模型或推理强度。
                        </p>
                      </div>
                      <div className="field resource-center-form-span-2">
                        <span className="field-label">示例 cURL</span>
                        <pre className="capability-center-preview-code">{buildCurlExample(apiBaseUrl, draft)}</pre>
                      </div>
                    </div>
                  )
                }
              ]}
            />

            <div className="resource-center-actions">
              <Space>
                <Button onClick={() => void handleValidate()} disabled={saving || validating}>
                  {validating ? "校验中..." : "校验配置"}
                </Button>
                <Button type="primary" onClick={() => void handleSave()} disabled={saving || validating}>
                  {saving ? "保存中..." : "保存实例"}
                </Button>
              </Space>
            </div>
          </>
        ) : null}

        {activeTab === "usage" ? <ExternalApiUsageView instanceId={props.detail.instance.id} /> : null}
      </Card>
    </section>
  );
}
