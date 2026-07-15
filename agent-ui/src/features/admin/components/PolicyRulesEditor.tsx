import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Drawer, Modal, Select } from "antd";
import { Building2, MoreHorizontal, ShieldCheck, UserRound, Users } from "lucide-react";

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
  addInDrawer?: boolean;
  referenceAccessLayout?: boolean;
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

const FALLBACK_ROLE_SUBJECT_LABELS: Record<string, string> = {
  employee: "员工",
  admin: "管理员",
  super_admin: "超级管理员",
  org_internal_user: "内部员工",
  org_internal_admin: "内部管理员",
  org_external_user: "外部 User",
  org_external_admin: "外部 Admin"
};

const FALLBACK_ROLE_SUBJECT_IDS = Object.keys(FALLBACK_ROLE_SUBJECT_LABELS);

const SUBJECT_TYPE_OPTIONS: Array<{ label: string; value: PolicyRuleSubjectType }> = [
  { label: "角色", value: "role" },
  { label: "部门", value: "department" },
  { label: "用户", value: "user" }
];

const EFFECT_OPTIONS: Array<{ label: string; value: PolicyRuleEffect }> = [
  { label: "允许", value: "allow" },
  { label: "拒绝", value: "deny" }
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
    const name = String(node.name || "").trim() || "未命名部门";
    const prefix = depth > 0 ? `${"  ".repeat(depth)}↳ ` : "";
    const baseLabel = `${prefix}${name}`;
    if (id) {
      bucket.push({
        value: id,
        label: baseLabel
      });
    }
    if (externalId && externalId !== id) {
      bucket.push({
        value: externalId,
        label: baseLabel
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
        upsertOption(
          roleMap,
          value,
          FALLBACK_ROLE_SUBJECT_LABELS[value] ?? value
        );
      }

      for (const role of rolesResp.roles || []) {
        const roleId = String(role.id || "").trim();
        const roleSlug = String(role.slug || "").trim();
        const roleName = String(role.name || "").trim() || roleSlug || roleId;
        if (roleSlug) {
          upsertOption(roleMap, roleSlug, roleName);
        }
        if (roleId && roleId !== roleSlug) {
          upsertOption(roleMap, roleId, roleName);
        }
      }

      for (const user of usersResp.users || []) {
        const userId = String(user.id || "").trim();
        if (userId) {
          const displayName = user.synced?.displayName || user.synced?.email || "未命名用户";
          upsertOption(userMap, userId, displayName);
        }
        const localRole = String(user.local?.role || "").trim();
        if (localRole) {
          upsertOption(roleMap, localRole, FALLBACK_ROLE_SUBJECT_LABELS[localRole] ?? localRole);
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
    addInDrawer = false,
    referenceAccessLayout = false,
    onChange,
    onSave
  } = props;
  const [subjectDirectory, setSubjectDirectory] = useState<SubjectDirectory>(EMPTY_SUBJECT_DIRECTORY);
  const [subjectDirectoryLoading, setSubjectDirectoryLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [draftRule, setDraftRule] = useState<PolicyRuleValue>({ ...EMPTY_RULE });

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

  function subjectDisplay(rule: PolicyRuleValue): string {
    return subjectOptionMap[rule.subjectType].get(rule.subjectId)?.label || rule.subjectId || "未选择主体";
  }

  function subjectTypeLabel(subjectType: PolicyRuleSubjectType): string {
    if (subjectType === "role") return "角色";
    if (subjectType === "department") return "部门";
    return "用户";
  }

  function subjectIcon(subjectType: PolicyRuleSubjectType) {
    if (subjectType === "role") return <ShieldCheck />;
    if (subjectType === "department") return <Building2 />;
    return <UserRound />;
  }

  if (referenceAccessLayout) {
    const allowRules = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.effect === "allow");
    const denyRules = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.effect === "deny");
    return (
      <>
        <div className="access-policy-board">
          <div className="access-policy-board-header">
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
            <div>
              <Button disabled={loading || saving || !ready} onClick={() => { setDraftRule({ ...EMPTY_RULE }); setAddOpen(true); }}>{addLabel}</Button>
              <Button type="primary" ghost onClick={onSave} disabled={saving || loading || !ready}>{saving ? savingLabel : saveLabel}</Button>
            </div>
          </div>

          {loading ? <p className="resource-center-subtle">{loadingText}</p> : null}
          {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
          {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

          <div className="access-policy-group">
            <div className="access-policy-group-title"><span><Users />允许使用</span><small>{allowRules.length ? `${allowRules.length} 条显式规则` : "使用默认访问范围"}</small></div>
            <div className="access-policy-row inherited">
              <span className="access-policy-row-icon"><Users /></span>
              <span><strong>组织成员</strong><small>未命中例外时，遵循上方默认访问范围</small></span>
              <span><small>规则来源</small><b>智能体默认设置</b></span>
              <span className="access-policy-effect allow">默认</span>
            </div>
            {allowRules.map(({ rule, index }) => <div className="access-policy-row" key={`allow-${rule.subjectType}-${rule.subjectId}-${index}`}>
              <span className="access-policy-row-icon allow">{subjectIcon(rule.subjectType)}</span>
              <span><strong>{subjectDisplay(rule)}</strong><small>{subjectTypeLabel(rule.subjectType)} · 显式允许</small></span>
              <span><small>规则来源</small><b>当前智能体</b></span>
              <span className="access-policy-effect allow">允许</span>
              <Button type="text" aria-label={`删除 ${subjectDisplay(rule)} 规则`} icon={<MoreHorizontal />} onClick={() => void removeRule(index)} />
            </div>)}
          </div>

          <div className="access-policy-group exceptions">
            <div className="access-policy-group-title"><span><ShieldCheck />拒绝例外</span><small>{denyRules.length ? `${denyRules.length} 条规则优先执行` : "暂无拒绝例外"}</small></div>
            {denyRules.length ? denyRules.map(({ rule, index }) => <div className="access-policy-row" key={`deny-${rule.subjectType}-${rule.subjectId}-${index}`}>
              <span className="access-policy-row-icon deny">{subjectIcon(rule.subjectType)}</span>
              <span><strong>{subjectDisplay(rule)}</strong><small>{subjectTypeLabel(rule.subjectType)} · 显式拒绝</small></span>
              <span><small>优先级</small><b>高于允许规则</b></span>
              <span className="access-policy-effect deny">拒绝</span>
              <Button type="text" aria-label={`删除 ${subjectDisplay(rule)} 规则`} icon={<MoreHorizontal />} onClick={() => void removeRule(index)} />
            </div>) : <div className="access-policy-empty"><ShieldCheck /><span><strong>没有拒绝例外</strong><small>需要排除特定角色、部门或用户时再添加。</small></span></div>}
          </div>
        </div>
        <Modal
          className="capability-policy-reference-modal"
          title="添加例外"
          width={440}
          open={addOpen}
          onCancel={() => setAddOpen(false)}
          footer={<div className="agent-drawer-footer"><Button onClick={() => setAddOpen(false)}>取消</Button><Button type="primary" disabled={!draftRule.subjectId.trim()} onClick={() => { onChange([...rules, draftRule]); setAddOpen(false); }}>添加到草稿</Button></div>}
        >
          <p className="policy-drawer-intro">选择允许或拒绝，再指定需要命中的角色、部门或用户。</p>
          <div className="policy-drawer-effect-choice">
            <button type="button" className={draftRule.effect === "allow" ? "active allow" : "allow"} onClick={() => setDraftRule((rule) => ({ ...rule, effect: "allow" }))}><strong>允许访问</strong><small>主体命中时允许继续使用</small></button>
            <button type="button" className={draftRule.effect === "deny" ? "active deny" : "deny"} onClick={() => setDraftRule((rule) => ({ ...rule, effect: "deny" }))}><strong>拒绝访问</strong><small>拒绝规则优先于允许规则</small></button>
          </div>
          <div className="policy-drawer-fields">
            <label><span>主体类型</span><Select value={draftRule.subjectType} options={SUBJECT_TYPE_OPTIONS} onChange={(value) => setDraftRule((rule) => ({ ...rule, subjectType: value as PolicyRuleSubjectType, subjectId: "" }))} /></label>
            <label><span>主体标识</span><Select value={draftRule.subjectId || undefined} showSearch optionFilterProp="label" placeholder={subjectIdPlaceholder(draftRule.subjectType)} options={resolveSubjectIdOptions(draftRule)} loading={subjectDirectoryLoading} onChange={(value) => setDraftRule((rule) => ({ ...rule, subjectId: String(value || "") }))} /></label>
          </div>
        </Modal>
      </>
    );
  }

  return (
    <>
    <Card className="resource-center-section resource-policy-editor antd-admin-card" size="small">
      <div className="resource-center-section-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <Button
          type="default"
          disabled={loading || saving || !ready}
          onClick={() => {
            if (!addInDrawer) {
              onChange([...rules, { ...EMPTY_RULE }]);
              return;
            }
            setDraftRule({ ...EMPTY_RULE });
            setAddOpen(true);
          }}
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
    {addInDrawer ? <Drawer
      className="capability-policy-reference-drawer"
      title="添加访问规则"
      width={420}
      open={addOpen}
      onClose={() => setAddOpen(false)}
      footer={<div className="agent-drawer-footer"><Button onClick={() => setAddOpen(false)}>取消</Button><Button type="primary" disabled={!draftRule.subjectId.trim()} onClick={() => { onChange([...rules, draftRule]); setAddOpen(false); }}>添加规则</Button></div>}
    >
      <p className="policy-drawer-intro">选择允许或拒绝，再指定需要命中的角色、部门或用户。</p>
      <div className="policy-drawer-effect-choice">
        <button className={draftRule.effect === "allow" ? "active allow" : "allow"} onClick={() => setDraftRule((rule) => ({ ...rule, effect: "allow" }))}><strong>允许访问</strong><small>主体命中时允许继续使用</small></button>
        <button className={draftRule.effect === "deny" ? "active deny" : "deny"} onClick={() => setDraftRule((rule) => ({ ...rule, effect: "deny" }))}><strong>拒绝访问</strong><small>拒绝规则优先于允许规则</small></button>
      </div>
      <div className="policy-drawer-fields">
        <label><span>主体类型</span><Select value={draftRule.subjectType} options={SUBJECT_TYPE_OPTIONS} onChange={(value) => setDraftRule((rule) => ({ ...rule, subjectType: value as PolicyRuleSubjectType, subjectId: "" }))} /></label>
        <label><span>主体标识</span><Select value={draftRule.subjectId || undefined} showSearch optionFilterProp="label" placeholder={subjectIdPlaceholder(draftRule.subjectType)} options={resolveSubjectIdOptions(draftRule)} loading={subjectDirectoryLoading} onChange={(value) => setDraftRule((rule) => ({ ...rule, subjectId: String(value || "") }))} /></label>
      </div>
    </Drawer> : null}
    </>
  );
}
