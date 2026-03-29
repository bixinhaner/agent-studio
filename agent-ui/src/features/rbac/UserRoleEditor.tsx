import { useEffect, useMemo, useState } from "react";

import { fetchRoles, fetchUserRoles, putUserRoles } from "./api";
import type { RoleSummary, UserRoleAssignment } from "./types";

export function UserRoleEditor(props: {
  userId: string;
  onSaved?(): void;
  onCancel?(): void;
}) {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [assignments, setAssignments] = useState<UserRoleAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [roleResponse, assignmentResponse] = await Promise.all([fetchRoles(), fetchUserRoles(props.userId)]);
        if (!active) return;
        setRoles(roleResponse.roles.filter((role) => role.isActive));
        setAssignments(assignmentResponse.userRoles);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载角色分配失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [props.userId]);

  const selectedRoleIds = useMemo(() => new Set(assignments.map((assignment) => assignment.roleId)), [assignments]);
  const primaryRoleId = assignments.find((assignment) => assignment.isPrimary)?.roleId ?? "";

  function toggleRole(role: RoleSummary, checked: boolean) {
    setAssignments((current) => {
      if (checked) {
        if (current.some((assignment) => assignment.roleId === role.id)) {
          return current;
        }
        return [
          ...current,
          {
            roleId: role.id,
            roleSlug: role.slug,
            roleName: role.name,
            roleIsSystem: role.isSystem,
            roleIsActive: role.isActive,
            isPrimary: current.length === 0
          }
        ];
      }
      const next = current.filter((assignment) => assignment.roleId !== role.id);
      if (next.length > 0 && !next.some((assignment) => assignment.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  function setPrimary(roleId: string) {
    setAssignments((current) => current.map((assignment) => ({ ...assignment, isPrimary: assignment.roleId === roleId })));
  }

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    try {
      await putUserRoles(props.userId, {
        assignments: assignments.map((assignment) => ({ roleId: assignment.roleId, isPrimary: assignment.isPrimary }))
      });
      props.onSaved?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存角色分配失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-inline-editor" aria-label="角色分配表单">
      <h3>角色分配</h3>
      {loading ? <p>加载中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      <div className="rbac-option-list">
        {roles.map((role) => (
          <div key={role.id} className="rbac-role-option">
            <label className="rbac-option">
              <input
                type="checkbox"
                aria-label={`选择角色 ${role.slug}`}
                checked={selectedRoleIds.has(role.id)}
                onChange={(event) => toggleRole(role, event.target.checked)}
              />
              <span>{role.name}</span>
            </label>
            {selectedRoleIds.has(role.id) ? (
              <label className="rbac-option">
                <input
                  type="radio"
                  name={`primary-role-${props.userId}`}
                  aria-label={`设为主角色 ${role.slug}`}
                  checked={primaryRoleId === role.id}
                  onChange={() => setPrimary(role.id)}
                />
                <span>主角色</span>
              </label>
            ) : null}
          </div>
        ))}
      </div>
      <div className="admin-actions-row">
        <button type="button" className="admin-action-btn" disabled={saving || assignments.length === 0} onClick={() => void handleSave()}>
          保存角色分配
        </button>
        {props.onCancel ? (
          <button type="button" className="admin-secondary-btn" disabled={saving} onClick={props.onCancel}>
            取消
          </button>
        ) : null}
      </div>
    </section>
  );
}
