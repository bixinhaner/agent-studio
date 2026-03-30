import { useEffect, useMemo, useState } from 'react';

import { fetchIntegrationBindings, putIntegrationBindings } from './api';
import type { IntegrationBindingInput } from './types';

type EditableBinding = IntegrationBindingInput;

const EMPTY_BINDING: EditableBinding = {
  targetType: 'workspace',
  targetId: '',
  bindingType: 'primary',
  bindingPayload: {}
};

function stringifyPayload(value: unknown) {
  if (!value || (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)) {
    return '{}';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}

export function IntegrationBindingsEditor(props: { instanceId: string }) {
  const [bindings, setBindings] = useState<Array<EditableBinding & { payloadText: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setReady(false);
      setErrorText('');
      setSuccessText('');
      try {
        const response = await fetchIntegrationBindings(props.instanceId);
        if (!active) return;
        setBindings(response.items.map((item) => ({
          targetType: item.targetType,
          targetId: item.targetId,
          bindingType: item.bindingType,
          bindingPayload: item.bindingPayload,
          payloadText: stringifyPayload(item.bindingPayload)
        })));
        setReady(true);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : '加载绑定关系失败');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [props.instanceId]);

  const hasInvalidBinding = useMemo(() => bindings.some((item) => !item.targetType.trim() || !item.targetId.trim() || !item.bindingType.trim()), [bindings]);

  async function handleSave() {
    if (hasInvalidBinding) {
      setErrorText('绑定类型和目标不能为空');
      return;
    }
    setSaving(true);
    setErrorText('');
    setSuccessText('');
    try {
      const payload = bindings.map((binding) => {
        let bindingPayload: unknown = {};
        try {
          bindingPayload = binding.payloadText.trim() ? JSON.parse(binding.payloadText) : {};
        } catch {
          throw new Error('绑定 payload 必须是合法 JSON');
        }
        return {
          targetType: binding.targetType.trim(),
          targetId: binding.targetId.trim(),
          bindingType: binding.bindingType.trim(),
          bindingPayload
        };
      });
      const response = await putIntegrationBindings(props.instanceId, payload);
      setBindings(response.items.map((item) => ({
        targetType: item.targetType,
        targetId: item.targetId,
        bindingType: item.bindingType,
        bindingPayload: item.bindingPayload,
        payloadText: stringifyPayload(item.bindingPayload)
      })));
      setSuccessText('绑定关系已保存');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存绑定关系失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="resource-center-section resource-policy-editor">
      <div className="resource-center-section-header">
        <div>
          <h3>绑定关系</h3>
          <p>维护集成实例和 workspace / agent mode 等资源的绑定关系。</p>
        </div>
        <button type="button" className="admin-secondary-btn" disabled={loading || saving || !ready} onClick={() => setBindings((current) => [...current, { ...EMPTY_BINDING, payloadText: '{}' }])}>
          新增绑定
        </button>
      </div>
      {loading ? <p className="resource-center-subtle">加载绑定关系中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {successText ? <p className="resource-center-success">{successText}</p> : null}
      <div className="resource-policy-list">
        {bindings.map((binding, index) => (
          <div key={`${props.instanceId}-${index}`} className="resource-policy-card">
            <div className="resource-policy-fields">
              <label className="field resource-policy-field">
                <span className="field-label">目标类型 {index + 1}</span>
                <input className="field-input" value={binding.targetType} onChange={(event) => setBindings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, targetType: event.target.value } : item))} />
              </label>
              <label className="field resource-policy-field">
                <span className="field-label">目标标识 {index + 1}</span>
                <input className="field-input" value={binding.targetId} onChange={(event) => setBindings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, targetId: event.target.value } : item))} />
              </label>
              <label className="field resource-policy-field">
                <span className="field-label">绑定类型 {index + 1}</span>
                <input className="field-input" value={binding.bindingType} onChange={(event) => setBindings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, bindingType: event.target.value } : item))} />
              </label>
            </div>
            <label className="field">
              <span className="field-label">绑定 payload {index + 1}</span>
              <textarea className="field-input integration-payload-input" value={binding.payloadText} onChange={(event) => setBindings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, payloadText: event.target.value } : item))} rows={4} />
            </label>
            <div className="resource-policy-actions">
              <button type="button" className="admin-secondary-btn" onClick={() => setBindings((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
      {!loading && bindings.length === 0 ? <p className="resource-center-empty">当前集成还没有绑定关系。</p> : null}
      <div className="resource-center-actions">
        <button type="button" className="admin-action-btn" disabled={loading || saving || !ready} onClick={() => void handleSave()}>
          {saving ? '保存中...' : '保存绑定'}
        </button>
      </div>
    </section>
  );
}
