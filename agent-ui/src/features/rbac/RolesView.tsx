import { useEffect, useState } from "react";
import { Button, Tag } from "antd";

import { cloneRole, createRole, disableRole, fetchRoles } from "./api";
import { RoleDetailView } from "./RoleDetailView";
import type { RoleSummary } from "./types";

function formatLocalTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function RolesView() {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [errorText, setErrorText] = useState("");

  async function load() {
    const response = await fetchRoles();
    setRoles(response.roles);
    setSelectedRoleId((current) => current || response.roles[0]?.id || "");
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate() {
    try {
      const response = await createRole({ slug, name, description: null });
      setSlug("");
      setName("");
      await load();
      setSelectedRoleId(response.role.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "创建角色失败");
    }
  }

  async function handleClone(role: RoleSummary) {
    const response = await cloneRole(role.id, {
      slug: `${role.slug}_copy`,
      name: `${role.name} Copy`,
      description: role.description ?? null
    });
    await load();
    setSelectedRoleId(response.role.id);
  }

  async function handleDisable(role: RoleSummary) {
    await disableRole(role.id);
    await load();
  }

  return (
    <div className="admin-stack-grid">
      <section className="admin-card">
        <div className="admin-section-header">
          <div>
            <h2>角色列表</h2>
            <p>系统角色与自定义角色统一管理。</p>
          </div>
          <div className="system-settings-meta-pill-group">
            <span className="system-settings-meta-pill">总数 {roles.length}</span>
            <span className="system-settings-meta-pill">激活 {roles.filter((role) => role.isActive).length}</span>
          </div>
        </div>
        {errorText ? <p className="err-text">{errorText}</p> : null}
        <div className="rbac-create-row">
          <input aria-label="角色 slug" className="field-input" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="slug" />
          <input aria-label="角色名称" className="field-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="名称" />
          <button type="button" className="admin-action-btn" onClick={() => void handleCreate()}>
            新建角色
          </button>
        </div>
        <div className="admin-density-list admin-role-density-list">
          {roles.map((role) => (
            <article key={role.id} className={selectedRoleId === role.id ? "admin-density-row active" : "admin-density-row"}>
              <div className="admin-density-primary">
                <strong>{role.name}</strong>
                <span>{role.description?.trim() || role.slug}</span>
              </div>

              <div className="admin-density-cell">
                <span className="admin-density-label">slug</span>
                <span className="admin-density-value">{role.slug}</span>
              </div>

              <div className="admin-density-cell">
                <span className="admin-density-label">类型</span>
                <span className="admin-density-value admin-density-tags">
                  <Tag>{role.isSystem ? "系统" : "自定义"}</Tag>
                  <Tag color={role.isActive ? "success" : "default"}>{role.isActive ? "active" : "disabled"}</Tag>
                </span>
              </div>

              <div className="admin-density-cell">
                <span className="admin-density-label">更新时间</span>
                <span className="admin-density-value">{formatLocalTime(role.updatedAt)}</span>
              </div>

              <div className="admin-density-actions">
                <Button size="small" onClick={() => setSelectedRoleId(role.id)}>
                  查看
                </Button>
                <Button size="small" onClick={() => void handleClone(role)}>
                  复制
                </Button>
                {!role.isSystem ? (
                  <Button size="small" onClick={() => void handleDisable(role)}>
                    禁用
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
      {selectedRoleId ? <RoleDetailView roleId={selectedRoleId} /> : null}
    </div>
  );
}
