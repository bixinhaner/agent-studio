import { useEffect, useMemo, useState } from 'react';

import { fetchIntegrationDetail, updateIntegrationInstance, validateIntegrationInstance } from './api';
import { IntegrationBindingsEditor } from './IntegrationBindingsEditor';
import { IntegrationPolicyEditor } from './IntegrationPolicyEditor';
import { IntegrationValidationHistory } from './IntegrationValidationHistory';
import type { DingTalkConfigInput, IntegrationDetail, IntegrationListItem, IntegrationSectionTab } from './types';

const TABS: Array<{ id: IntegrationSectionTab; label: string }> = [
  { id: 'basic', label: '基本信息' },
  { id: 'config', label: '配置' },
  { id: 'history', label: '验证与历史' },
  { id: 'bindings', label: '绑定关系' },
  { id: 'policies', label: '授权' }
];

function formatLocalDateTime(value?: string) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function readConfig(detail: IntegrationDetail): DingTalkConfigInput {
  return {
    clientId: typeof detail.config.clientId === 'string' ? detail.config.clientId : '',
    redirectUri: typeof detail.config.redirectUri === 'string' ? detail.config.redirectUri : '',
    scope: typeof detail.config.scope === 'string' ? detail.config.scope : '',
    apiBaseUrl: typeof detail.config.apiBaseUrl === 'string' ? detail.config.apiBaseUrl : '',
    alertAgentId: typeof detail.config.alertAgentId === 'string' ? detail.config.alertAgentId : '',
    alertUserIds: Array.isArray(detail.config.alertUserIds)
      ? detail.config.alertUserIds.filter((item): item is string => typeof item === 'string')
      : []
  };
}

export function DingTalkIntegrationView(props: {
  instanceId: string;
  onInstanceUpdated?(instance: IntegrationListItem): void;
}) {
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');
  const [activeTab, setActiveTab] = useState<IntegrationSectionTab>('basic');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');
  const [configDraft, setConfigDraft] = useState<DingTalkConfigInput>({});
  const [clientSecretDraft, setClientSecretDraft] = useState('');
  const [clearSecretState, setClearSecretState] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText('');
      try {
        const next = await fetchIntegrationDetail(props.instanceId);
        if (!active) return;
        setDetail(next);
        setName(next.instance.name);
        setDescription(next.instance.description || '');
        setStatus(next.instance.status);
        setConfigDraft(readConfig(next));
        setClientSecretDraft('');
        setClearSecretState(false);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : '加载 DingTalk 集成失败');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [props.instanceId]);

  const alertUserIdsText = useMemo(() => (configDraft.alertUserIds || []).join('\n'), [configDraft.alertUserIds]);

  async function handleSave() {
    setSaving(true);
    setErrorText('');
    setSuccessText('');
    try {
      const next = await updateIntegrationInstance(props.instanceId, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        config: {
          clientId: configDraft.clientId?.trim() || '',
          redirectUri: configDraft.redirectUri?.trim() || '',
          scope: configDraft.scope?.trim() || '',
          apiBaseUrl: configDraft.apiBaseUrl?.trim() || '',
          alertAgentId: configDraft.alertAgentId?.trim() || '',
          alertUserIds: alertUserIdsText
            .split(/\n|,/g)
            .map((item) => item.trim())
            .filter(Boolean)
        },
        secretState: clearSecretState ? null : clientSecretDraft.trim() ? { clientSecret: clientSecretDraft.trim() } : undefined
      });
      setDetail(next);
      setClientSecretDraft('');
      setClearSecretState(false);
      props.onInstanceUpdated?.(next.instance);
      setSuccessText('DingTalk 集成已保存');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存 DingTalk 集成失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setErrorText('');
    setSuccessText('');
    try {
      const next = await validateIntegrationInstance(props.instanceId);
      setDetail(next.detail);
      props.onInstanceUpdated?.(next.detail.instance);
      setSuccessText('DingTalk 凭证验证已完成');
      setActiveTab('history');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'DingTalk 验证失败');
    } finally {
      setValidating(false);
    }
  }

  if (loading || !detail) {
    return <section className="resource-center-section"><p>加载 DingTalk 集成中...</p></section>;
  }

  return (
    <section className="resource-center-section integration-detail-shell">
      <div className="resource-center-section-header">
        <div>
          <h3>DingTalk</h3>
          <p>登录、组织同步和通知配置统一在这里维护。</p>
        </div>
        <div className="resource-center-actions compact">
          <button type="button" className="admin-secondary-btn" disabled={validating} onClick={() => void handleValidate()}>
            {validating ? '验证中...' : '验证连接'}
          </button>
          <button type="button" className="admin-action-btn" disabled={saving} onClick={() => void handleSave()}>
            {saving ? '保存中...' : '保存集成'}
          </button>
        </div>
      </div>
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {successText ? <p className="resource-center-success">{successText}</p> : null}

      <div className="resource-center-type-tabs" role="tablist" aria-label="DingTalk 详情页签">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'resource-center-type-tab active' : 'resource-center-type-tab'} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'basic' ? (
        <div className="integration-form-grid">
          <label className="field">
            <span className="field-label">实例名称</span>
            <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">状态</span>
            <select className="field-input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="disabled">disabled</option>
              <option value="error">error</option>
            </select>
          </label>
          <label className="field integration-field-span-2">
            <span className="field-label">说明</span>
            <textarea className="field-input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="resource-center-summary-grid compact integration-summary-card integration-field-span-2">
            <div><span className="field-label">slug</span><p>{detail.instance.slug}</p></div>
            <div><span className="field-label">创建时间</span><p>{formatLocalDateTime(detail.instance.createdAt)}</p></div>
            <div><span className="field-label">更新时间</span><p>{formatLocalDateTime(detail.instance.updatedAt)}</p></div>
            <div><span className="field-label">密钥状态</span><p>{detail.secretState.hasSecrets ? '已保存密钥' : '未保存密钥'}</p></div>
          </div>
        </div>
      ) : null}

      {activeTab === 'config' ? (
        <div className="integration-form-grid">
          <label className="field">
            <span className="field-label">Client ID</span>
            <input className="field-input" value={configDraft.clientId || ''} onChange={(event) => setConfigDraft((current) => ({ ...current, clientId: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Redirect URI</span>
            <input className="field-input" value={configDraft.redirectUri || ''} onChange={(event) => setConfigDraft((current) => ({ ...current, redirectUri: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Scope</span>
            <input className="field-input" value={configDraft.scope || ''} onChange={(event) => setConfigDraft((current) => ({ ...current, scope: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">API Base URL</span>
            <input className="field-input" value={configDraft.apiBaseUrl || ''} onChange={(event) => setConfigDraft((current) => ({ ...current, apiBaseUrl: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">通知 Agent ID</span>
            <input className="field-input" value={configDraft.alertAgentId || ''} onChange={(event) => setConfigDraft((current) => ({ ...current, alertAgentId: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Client Secret</span>
            <input className="field-input" type="password" value={clientSecretDraft} placeholder={detail.secretState.hasSecrets ? '已保存密钥' : ''} onChange={(event) => { setClientSecretDraft(event.target.value); setClearSecretState(false); }} />
          </label>
          <label className="field integration-field-span-2">
            <span className="field-label">通知用户 IDs</span>
            <textarea className="field-input" rows={4} value={alertUserIdsText} onChange={(event) => setConfigDraft((current) => ({ ...current, alertUserIds: event.target.value.split(/\n|,/g).map((item) => item.trim()).filter(Boolean) }))} />
          </label>
          <label className="field integration-checkbox-row integration-field-span-2">
            <input type="checkbox" checked={clearSecretState} onChange={(event) => setClearSecretState(event.target.checked)} />
            <span>清空当前保存的 Client Secret</span>
          </label>
        </div>
      ) : null}

      {activeTab === 'history' ? <IntegrationValidationHistory items={detail.validationHistory.items} /> : null}
      {activeTab === 'bindings' ? <IntegrationBindingsEditor instanceId={props.instanceId} /> : null}
      {activeTab === 'policies' ? <IntegrationPolicyEditor instanceId={props.instanceId} /> : null}
    </section>
  );
}
