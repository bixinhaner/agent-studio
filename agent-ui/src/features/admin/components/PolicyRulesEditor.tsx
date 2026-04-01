import { Alert, Button, Card, Input, Select } from "antd";

import { openWarningConfirm } from "../../../lib/warning-modal";

export type PolicyRuleSubjectType = "role" | "department" | "user";
export type PolicyRuleEffect = "allow" | "deny";

export type PolicyRuleValue = {
  subjectType: PolicyRuleSubjectType;
  subjectId: string;
  effect: PolicyRuleEffect;
};

type PolicyRulesEditorProps = {
  title: string;
  description: string;
  addLabel?: string;
  saveLabel?: string;
  savingLabel?: string;
  loadingText?: string;
  emptyText: string;
  rules: PolicyRuleValue[];
  loading: boolean;
  saving: boolean;
  ready: boolean;
  errorText?: string;
  successText?: string;
  onChange(rules: PolicyRuleValue[]): void;
  onSave(): void;
};

const SUBJECT_TYPE_OPTIONS: Array<{ label: string; value: PolicyRuleSubjectType }> = [
  { label: "role", value: "role" },
  { label: "department", value: "department" },
  { label: "user", value: "user" }
];

const EFFECT_OPTIONS: Array<{ label: string; value: PolicyRuleEffect }> = [
  { label: "allow", value: "allow" },
  { label: "deny", value: "deny" }
];

const EMPTY_RULE: PolicyRuleValue = {
  subjectType: "role",
  subjectId: "",
  effect: "allow"
};

export function PolicyRulesEditor(props: PolicyRulesEditorProps) {
  const {
    title,
    description,
    addLabel = "新增策略",
    saveLabel = "保存授权",
    savingLabel = "保存中...",
    loadingText = "加载授权中...",
    emptyText,
    rules,
    loading,
    saving,
    ready,
    errorText,
    successText,
    onChange,
    onSave
  } = props;

  function updateRule(index: number, patch: Partial<PolicyRuleValue>) {
    onChange(rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  }

  async function removeRule(index: number) {
    const target = rules[index];
    const targetLabel = target?.subjectId?.trim() || `第 ${index + 1} 条规则`;
    const confirmed = await openWarningConfirm({
      title: "确认删除规则",
      content: `确认删除 ${targetLabel} 吗？`,
      description: "删除后需要重新保存才会生效。",
      dangerLevel: "warning",
      okText: "删除",
      cancelText: "取消",
      okButtonDanger: false
    });
    if (!confirmed) return;
    onChange(rules.filter((_, ruleIndex) => ruleIndex !== index));
  }

  return (
    <Card className="resource-center-section resource-policy-editor antd-admin-card" size="small">
      <div className="resource-center-section-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <Button
          type="default"
          disabled={loading || saving || !ready}
          onClick={() => onChange([...rules, { ...EMPTY_RULE }])}
        >
          {addLabel}
        </Button>
      </div>

      {loading ? <p className="resource-center-subtle">{loadingText}</p> : null}
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

      <div className="resource-policy-list">
        {rules.map((rule, index) => (
          <div key={`${rule.subjectType}-${rule.subjectId}-${index}`} className="resource-policy-card">
            <div className="resource-policy-fields">
              <label className="field resource-policy-field">
                <span className="field-label">主体类型 {index + 1}</span>
                <Select
                  aria-label={`主体类型 ${index + 1}`}
                  value={rule.subjectType}
                  disabled={loading || saving}
                  options={SUBJECT_TYPE_OPTIONS}
                  onChange={(value) => updateRule(index, { subjectType: value as PolicyRuleSubjectType })}
                />
              </label>

              <label className="field resource-policy-field">
                <span className="field-label">主体标识 {index + 1}</span>
                <Input
                  aria-label={`主体标识 ${index + 1}`}
                  value={rule.subjectId}
                  disabled={loading || saving}
                  placeholder="如 employee / dept-rd / user-123"
                  onChange={(event) => updateRule(index, { subjectId: event.target.value })}
                />
              </label>

              <label className="field resource-policy-field">
                <span className="field-label">授权效果 {index + 1}</span>
                <Select
                  aria-label={`授权效果 ${index + 1}`}
                  value={rule.effect}
                  disabled={loading || saving}
                  options={EFFECT_OPTIONS}
                  onChange={(value) => updateRule(index, { effect: value as PolicyRuleEffect })}
                />
              </label>
            </div>

            <div className="resource-policy-actions">
              <Button type="default" disabled={loading || saving} onClick={() => void removeRule(index)}>
                删除
              </Button>
            </div>
          </div>
        ))}
      </div>

      {!loading && rules.length === 0 ? <p className="resource-center-empty">{emptyText}</p> : null}

      <div className="resource-center-actions">
        <Button type="primary" onClick={onSave} disabled={saving || loading || !ready}>
          {saving ? savingLabel : saveLabel}
        </Button>
      </div>
    </Card>
  );
}
