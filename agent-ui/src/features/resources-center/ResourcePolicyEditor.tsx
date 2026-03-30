import { useEffect, useMemo, useState } from "react";

import { fetchResourcePolicies, putResourcePolicies } from "./api";
import type {
  ResourcePolicyEffect,
  ResourcePolicyInput,
  ResourcePolicyResourceType,
  ResourcePolicySubjectType
} from "./types";

type EditablePolicy = {
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  effect: ResourcePolicyEffect;
};

type ResourcePolicyEditorProps = {
  resourceType: ResourcePolicyResourceType;
  resourceId: string;
  title?: string;
};

const EMPTY_POLICY: EditablePolicy = {
  subjectType: "role",
  subjectId: "",
  effect: "allow"
};

function normalizePolicies(policies: ResourcePolicyInput[]) {
  return policies.map((policy) => ({
    subjectType: policy.subjectType,
    subjectId: policy.subjectId,
    effect: policy.effect
  }));
}

export function ResourcePolicyEditor({ resourceType, resourceId, title = "资源策略" }: ResourcePolicyEditorProps) {
  const [policies, setPolicies] = useState<EditablePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorText("");
      setSuccessText("");
      try {
        const response = await fetchResourcePolicies(resourceType, resourceId);
        if (!active) return;
        setPolicies(normalizePolicies(response.policies));
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载资源授权失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [resourceId, resourceType]);

  const hasInvalidPolicy = useMemo(() => {
    return policies.some((policy) => !policy.subjectId.trim());
  }, [policies]);

  function updatePolicy(index: number, patch: Partial<EditablePolicy>) {
    setPolicies((current) => current.map((policy, policyIndex) => (policyIndex === index ? { ...policy, ...patch } : policy)));
    setSuccessText("");
  }

  function removePolicy(index: number) {
    setPolicies((current) => current.filter((_, policyIndex) => policyIndex !== index));
    setSuccessText("");
  }

  async function handleSave() {
    if (hasInvalidPolicy) {
      setErrorText("主体标识不能为空");
      return;
    }

    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await putResourcePolicies(resourceType, resourceId, policies.map((policy) => ({
        subjectType: policy.subjectType,
        subjectId: policy.subjectId.trim(),
        effect: policy.effect
      })));
      setPolicies(normalizePolicies(response.policies));
      setSuccessText("资源授权已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存资源授权失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="resource-center-section resource-policy-editor">
      <div className="resource-center-section-header">
        <div>
          <h3>{title}</h3>
          <p>按单个资源维护角色、部门和用户的允许或拒绝策略。</p>
        </div>
        <button
          type="button"
          className="admin-secondary-btn"
          onClick={() => {
            setPolicies((current) => [...current, { ...EMPTY_POLICY }]);
            setErrorText("");
            setSuccessText("");
          }}
        >
          新增策略
        </button>
      </div>

      {loading ? <p className="resource-center-subtle">加载资源授权中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {successText ? <p className="resource-center-success">{successText}</p> : null}

      <div className="resource-policy-list">
        {policies.map((policy, index) => (
          <div key={`${resourceId}-${index}`} className="resource-policy-card">
            <div className="resource-policy-fields">
              <label className="field resource-policy-field">
                <span className="field-label">主体类型 {index + 1}</span>
                <select
                  className="field-input"
                  aria-label={`主体类型 ${index + 1}`}
                  value={policy.subjectType}
                  onChange={(event) => updatePolicy(index, { subjectType: event.target.value as ResourcePolicySubjectType })}
                >
                  <option value="role">role</option>
                  <option value="department">department</option>
                  <option value="user">user</option>
                </select>
              </label>

              <label className="field resource-policy-field">
                <span className="field-label">主体标识 {index + 1}</span>
                <input
                  className="field-input"
                  aria-label={`主体标识 ${index + 1}`}
                  value={policy.subjectId}
                  onChange={(event) => updatePolicy(index, { subjectId: event.target.value })}
                  placeholder="如 employee / dept-rd / user-123"
                />
              </label>

              <label className="field resource-policy-field">
                <span className="field-label">授权效果 {index + 1}</span>
                <select
                  className="field-input"
                  aria-label={`授权效果 ${index + 1}`}
                  value={policy.effect}
                  onChange={(event) => updatePolicy(index, { effect: event.target.value as ResourcePolicyEffect })}
                >
                  <option value="allow">allow</option>
                  <option value="deny">deny</option>
                </select>
              </label>
            </div>

            <div className="resource-policy-actions">
              <button
                type="button"
                className="admin-secondary-btn"
                onClick={() => removePolicy(index)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {!loading && policies.length === 0 ? <p className="resource-center-empty">当前资源还没有显式授权策略。</p> : null}

      <div className="resource-center-actions">
        <button
          type="button"
          className="admin-action-btn"
          onClick={() => void handleSave()}
          disabled={saving || loading}
        >
          {saving ? "保存中..." : "保存资源授权"}
        </button>
      </div>
    </section>
  );
}
