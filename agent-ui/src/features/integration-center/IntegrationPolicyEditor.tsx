import { useEffect, useMemo, useState } from 'react';

import { fetchIntegrationPolicies, putIntegrationPolicies } from './api';
import type { IntegrationPolicyInput } from './types';

type EditablePolicy = IntegrationPolicyInput;

const EMPTY_POLICY: EditablePolicy = {
  subjectType: 'role',
  subjectId: '',
  effect: 'allow'
};

export function IntegrationPolicyEditor(props: { instanceId: string }) {
  const [policies, setPolicies] = useState<EditablePolicy[]>([]);
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
        const response = await fetchIntegrationPolicies(props.instanceId);
        if (!active) return;
        setPolicies(response.items.map((item) => ({ ...item })));
        setReady(true);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : '加载集成授权失败');
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

  const hasInvalidPolicy = useMemo(() => policies.some((item) => !item.subjectId.trim()), [policies]);

  async function handleSave() {
    if (hasInvalidPolicy) {
      setErrorText('主体标识不能为空');
      return;
    }
    setSaving(true);
    setErrorText('');
    setSuccessText('');
    try {
      const response = await putIntegrationPolicies(props.instanceId, policies.map((item) => ({ ...item, subjectId: item.subjectId.trim() })));
      setPolicies(response.items.map((item) => ({ ...item })));
      setSuccessText('集成授权已保存');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存集成授权失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="resource-center-section resource-policy-editor">
      <div className="resource-center-section-header">
        <div>
          <h3>授权</h3>
          <p>按单个集成实例维护角色、部门和用户的 allow / deny 策略。</p>
        </div>
        <button
          type="button"
          className="admin-secondary-btn"
          disabled={loading || saving || !ready}
          onClick={() => setPolicies((current) => [...current, { ...EMPTY_POLICY }])}
        >
          新增策略
        </button>
      </div>
      {loading ? <p className="resource-center-subtle">加载集成授权中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {successText ? <p className="resource-center-success">{successText}</p> : null}
      <div className="resource-policy-list">
        {policies.map((policy, index) => (
          <div key={`${props.instanceId}-${index}`} className="resource-policy-card">
            <div className="resource-policy-fields">
              <label className="field resource-policy-field">
                <span className="field-label">主体类型 {index + 1}</span>
                <select className="field-input" value={policy.subjectType} onChange={(event) => setPolicies((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, subjectType: event.target.value as EditablePolicy['subjectType'] } : item))}>
                  <option value="role">role</option>
                  <option value="department">department</option>
                  <option value="user">user</option>
                </select>
              </label>
              <label className="field resource-policy-field">
                <span className="field-label">主体标识 {index + 1}</span>
                <input className="field-input" value={policy.subjectId} onChange={(event) => setPolicies((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, subjectId: event.target.value } : item))} />
              </label>
              <label className="field resource-policy-field">
                <span className="field-label">授权效果 {index + 1}</span>
                <select className="field-input" value={policy.effect} onChange={(event) => setPolicies((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, effect: event.target.value as EditablePolicy['effect'] } : item))}>
                  <option value="allow">allow</option>
                  <option value="deny">deny</option>
                </select>
              </label>
            </div>
            <div className="resource-policy-actions">
              <button type="button" className="admin-secondary-btn" onClick={() => setPolicies((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
      {!loading && policies.length === 0 ? <p className="resource-center-empty">当前集成还没有显式授权策略。</p> : null}
      <div className="resource-center-actions">
        <button type="button" className="admin-action-btn" disabled={loading || saving || !ready} onClick={() => void handleSave()}>
          {saving ? '保存中...' : '保存授权'}
        </button>
      </div>
    </section>
  );
}
