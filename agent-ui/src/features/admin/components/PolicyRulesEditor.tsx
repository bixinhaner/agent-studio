import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Select } from "antd";

import { openWarningConfirm } from "../../../lib/warning-modal";
import { fetchAdminUsers, fetchDepartmentTree } from "../api";
import { fetchRoles } from "../../rbac/api";

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

type SubjectOption = {
  label: string;
  value: string;
};

type SubjectDirectory = Record<PolicyRuleSubjectType, SubjectOption[]>;

const EMPTY_SUBJECT_DIRECTORY: SubjectDirectory = {
  role: [],
  department: [],
  user: []
};

const FALLBACK_ROLE_SUBJECT_IDS = ["employee", "admin", "super_admin"];

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

let subjectDirectoryCache: SubjectDirectory | null = null;
let subjectDirectoryRequest: Promise<SubjectDirectory> | null = null;

function buildOptionLabel(main: string, detail?: string): string {
  const normalizedMain = String(main || "").trim();
  const normalizedDetail = String(detail || "").trim();
  if (!normalizedDetail) return normalizedMain;
  return `${normalizedMain} · ${normalizedDetail}`;
}

function upsertOption(target: Map<string, SubjectOption>, value: string, label: string) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue || target.has(normalizedValue)) return;
  target.set(normalizedValue, {
    value: normalizedValue,
    label: String(label || normalizedValue).trim() || normalizedValue
  });
}

function flattenDepartmentOptions(
  nodes: Array<{
    id: string;
    name: string;
    externalId: string;
    children?: unknown[];
  }>,
  depth = 0,
  bucket: SubjectOption[] = []
): SubjectOption[] {
  for (const node of nodes) {
    const id = String(node.id || "").trim();
    const externalId = String(node.externalId || "").trim();
    const name = String(node.name || "").trim() || externalId || id;
    const prefix = depth > 0 ? `${"  ".repeat(depth)}↳ ` : "";
    const baseLabel = `${prefix}${name}`;
    if (id) {
      bucket.push({
        value: id,
        label: buildOptionLabel(baseLabel, externalId && externalId !== id ? `ID ${id} / external ${externalId}` : `ID ${id}`)
      });
    }
    if (externalId && externalId !== id) {
      bucket.push({
        value: externalId,
        label: buildOptionLabel(baseLabel, `external ${externalId}`)
      });
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      flattenDepartmentOptions(node.children as Array<{ id: string; name: string; externalId: string; children?: unknown[] }>, depth + 1, bucket);
    }
  }
  return bucket;
}

async function resolveSubjectDirectory(): Promise<SubjectDirectory> {
  if (subjectDirectoryCache) return subjectDirectoryCache;
  if (subjectDirectoryRequest) return subjectDirectoryRequest;

  subjectDirectoryRequest = Promise.all([
    fetchRoles().catch(() => ({ roles: [] as Array<{ id: string; slug: string; name: string }> })),
    fetchDepartmentTree().catch(() => ({ departments: [] as Array<{ id: string; name: string; externalId: string; children?: unknown[] }> })),
    fetchAdminUsers().catch(
      () =>
        ({
          users: [] as Array<{
            id: string;
            local: { role: string };
            synced: { displayName: string | null; email: string | null; dingtalkUserId: string | null };
          }>
        })
    )
  ])
    .then(([rolesResp, departmentsResp, usersResp]) => {
      const roleMap = new Map<string, SubjectOption>();
      const departmentMap = new Map<string, SubjectOption>();
      const userMap = new Map<string, SubjectOption>();

      for (const value of FALLBACK_ROLE_SUBJECT_IDS) {
        upsertOption(roleMap, value, buildOptionLabel(value, "legacy role"));
      }

      for (const role of rolesResp.roles || []) {
        const roleId = String(role.id || "").trim();
        const roleSlug = String(role.slug || "").trim();
        const roleName = String(role.name || "").trim() || roleSlug || roleId;
        if (roleSlug) {
          upsertOption(roleMap, roleSlug, buildOptionLabel(roleName, `slug ${roleSlug}`));
        }
        if (roleId && roleId !== roleSlug) {
          upsertOption(roleMap, roleId, buildOptionLabel(roleName, `id ${roleId}`));
        }
      }

      for (const user of usersResp.users || []) {
        const userId = String(user.id || "").trim();
        if (userId) {
          const displayName = user.synced?.displayName || user.synced?.email || user.synced?.dingtalkUserId || userId;
          upsertOption(userMap, userId, buildOptionLabel(displayName, `id ${userId}`));
        }
        const localRole = String(user.local?.role || "").trim();
        if (localRole) {
          upsertOption(roleMap, localRole, buildOptionLabel(localRole, "legacy role"));
        }
      }

      const departmentCandidates = flattenDepartmentOptions(departmentsResp.departments || []);
      for (const option of departmentCandidates) {
        upsertOption(departmentMap, option.value, option.label);
      }

      const nextDirectory: SubjectDirectory = {
        role: [...roleMap.values()],
        department: [...departmentMap.values()],
        user: [...userMap.values()]
      };
      subjectDirectoryCache = nextDirectory;
      return nextDirectory;
    })
    .finally(() => {
      subjectDirectoryRequest = null;
    });

  return subjectDirectoryRequest;
}

function subjectIdPlaceholder(subjectType: PolicyRuleSubjectType): string {
  if (subjectType === "role") return "请选择角色主体标识";
  if (subjectType === "department") return "请选择部门主体标识";
  return "请选择用户主体标识";
}

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
  const [subjectDirectory, setSubjectDirectory] = useState<SubjectDirectory>(EMPTY_SUBJECT_DIRECTORY);
  const [subjectDirectoryLoading, setSubjectDirectoryLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setSubjectDirectoryLoading(true);
    void resolveSubjectDirectory()
      .then((resolved) => {
        if (!active) return;
        setSubjectDirectory(resolved);
      })
      .catch(() => {
        if (!active) return;
        setSubjectDirectory(EMPTY_SUBJECT_DIRECTORY);
      })
      .finally(() => {
        if (active) setSubjectDirectoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const subjectOptionMap = useMemo(() => {
    const map: Record<PolicyRuleSubjectType, Map<string, SubjectOption>> = {
      role: new Map(subjectDirectory.role.map((item) => [item.value, item] as const)),
      department: new Map(subjectDirectory.department.map((item) => [item.value, item] as const)),
      user: new Map(subjectDirectory.user.map((item) => [item.value, item] as const))
    };
    return map;
  }, [subjectDirectory.department, subjectDirectory.role, subjectDirectory.user]);

  function resolveSubjectIdOptions(rule: PolicyRuleValue): SubjectOption[] {
    const map = new Map(subjectOptionMap[rule.subjectType]);
    const current = String(rule.subjectId || "").trim();
    if (current && !map.has(current)) {
      map.set(current, {
        value: current,
        label: buildOptionLabel(current, "当前策略值")
      });
    }
    return [...map.values()];
  }

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
                  onChange={(value) =>
                    updateRule(index, {
                      subjectType: value as PolicyRuleSubjectType,
                      subjectId: ""
                    })
                  }
                />
              </label>

              <label className="field resource-policy-field">
                <span className="field-label">主体标识 {index + 1}</span>
                <Select
                  aria-label={`主体标识 ${index + 1}`}
                  value={rule.subjectId || undefined}
                  disabled={loading || saving}
                  showSearch
                  optionFilterProp="label"
                  placeholder={subjectIdPlaceholder(rule.subjectType)}
                  options={resolveSubjectIdOptions(rule)}
                  loading={subjectDirectoryLoading}
                  onChange={(value) => updateRule(index, { subjectId: String(value || "") })}
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
