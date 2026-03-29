import { useEffect, useMemo, useState } from "react";

import { fetchRoleDetail, fetchRoleAuditLogs, putRolePermissions, putRoleResourcePolicies } from "./api";
import { PermissionMatrix } from "./PermissionMatrix";
import { RoleAuditView } from "./RoleAuditView";
import type { ResourcePolicySummary, RoleDetailResponse } from "./types";

type DetailTab = "permissions" | "resources" | "audit";

export function RoleDetailView(props: { roleId: string }) {
  const [detail, setDetail] = useState<RoleDetailResponse | null>(null);
  const [auditLogs, setAuditLogs] = useState<RoleDetailResponse["recentAuditEntries"]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [tab, setTab] = useState<DetailTab>("permissions");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);
  const [resourcePolicies, setResourcePolicies] = useState<ResourcePolicySummary[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const [next, auditResponse] = await Promise.all([fetchRoleDetail(props.roleId), fetchRoleAuditLogs(props.roleId)]);
        if (!active) return;
        setDetail(next);
        setSelectedPermissionIds(next.permissions.filter((permission) => permission.assigned).map((permission) => permission.id));
        setResourcePolicies(next.resourcePolicies);
        setAuditLogs(auditResponse.auditLogs.length > 0 ? auditResponse.auditLogs : next.recentAuditEntries);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载角色详情失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [props.roleId]);

  const resourceGroups = useMemo(() => {
    const grouped = new Map<ResourcePolicySummary["resourceType"], ResourcePolicySummary[]>();
    for (const policy of resourcePolicies) {
      const bucket = grouped.get(policy.resourceType) ?? [];
      bucket.push(policy);
      grouped.set(policy.resourceType, bucket);
    }
    return grouped;
  }, [resourcePolicies]);

  function togglePermission(permissionId: string, checked: boolean) {
    setSelectedPermissionIds((current) =>
      checked ? [...new Set([...current, permissionId])] : current.filter((item) => item !== permissionId)
    );
  }

  function toggleResourcePolicy(policy: ResourcePolicySummary, checked: boolean) {
    setResourcePolicies((current) =>
      checked ? current : current.filter((item) => !(item.resourceType === policy.resourceType && item.resourceId === policy.resourceId))
    );
  }

  async function handleSave() {
    if (!detail) return;
    await putRolePermissions(detail.role.id, { permissionIds: selectedPermissionIds });
    const resourceTypes = new Set<ResourcePolicySummary["resourceType"]>([
      ...detail.resourcePolicies.map((policy) => policy.resourceType),
      ...resourcePolicies.map((policy) => policy.resourceType)
    ]);
    for (const resourceType of resourceTypes) {
      const policies = resourcePolicies.filter((policy) => policy.resourceType === resourceType);
      await putRoleResourcePolicies(detail.role.id, {
        resourceType,
        policies: policies.map((policy) => ({ resourceId: policy.resourceId, effect: policy.effect }))
      });
    }
  }

  if (loading) {
    return <section className="admin-card"><p>加载中...</p></section>;
  }

  if (errorText || !detail) {
    return <section className="admin-card"><p className="err-text">{errorText || "角色详情不可用"}</p></section>;
  }

  return (
    <section className="admin-card">
      <div className="admin-section-header">
        <div>
          <h2>{detail.role.name}</h2>
          <p>{detail.role.slug}</p>
        </div>
        <button type="button" className="admin-action-btn" onClick={() => void handleSave()}>
          保存角色配置
        </button>
      </div>
      <div className="admin-nav" role="tablist" aria-label="角色详情导航">
        <button type="button" role="tab" aria-selected={tab === "permissions"} className={tab === "permissions" ? "admin-nav-btn active" : "admin-nav-btn"} onClick={() => setTab("permissions")}>
          功能权限
        </button>
        <button type="button" role="tab" aria-selected={tab === "resources"} className={tab === "resources" ? "admin-nav-btn active" : "admin-nav-btn"} onClick={() => setTab("resources")}>
          资源授权
        </button>
        <button type="button" role="tab" aria-selected={tab === "audit"} className={tab === "audit" ? "admin-nav-btn active" : "admin-nav-btn"} onClick={() => setTab("audit")}>
          审计记录
        </button>
      </div>
      {tab === "permissions" ? (
        <PermissionMatrix permissions={detail.permissions} selectedPermissionIds={selectedPermissionIds} onToggle={togglePermission} />
      ) : null}
      {tab === "resources" ? (
        <div className="rbac-permission-matrix">
          {Array.from(resourceGroups.entries()).map(([resourceType, policies]) => (
            <section key={resourceType} className="rbac-group">
              <h4>{resourceType}</h4>
              <div className="rbac-option-list">
                {policies.map((policy) => (
                  <label key={`${policy.resourceType}:${policy.resourceId}:${policy.effect}`} className="rbac-option">
                    <input
                      type="checkbox"
                      aria-label={`${policy.resourceType} ${policy.resourceId} ${policy.effect}`}
                      checked
                      onChange={(event) => toggleResourcePolicy(policy, event.target.checked)}
                    />
                    <span>{policy.resourceId}</span>
                    <code>{policy.effect}</code>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {tab === "audit" ? <RoleAuditView auditLogs={auditLogs} /> : null}
    </section>
  );
}
