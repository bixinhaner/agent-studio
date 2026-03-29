import { useEffect, useState } from "react";

import { cloneRole, createRole, disableRole, fetchRoles } from "./api";
import { RoleDetailView } from "./RoleDetailView";
import type { RoleSummary } from "./types";

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
        </div>
        {errorText ? <p className="err-text">{errorText}</p> : null}
        <div className="rbac-create-row">
          <input aria-label="角色 slug" className="field-input" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="slug" />
          <input aria-label="角色名称" className="field-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="名称" />
          <button type="button" className="admin-action-btn" onClick={() => void handleCreate()}>
            新建角色
          </button>
        </div>
        <div className="admin-user-list">
          {roles.map((role) => (
            <article key={role.id} className={`admin-list-card ${selectedRoleId === role.id ? "rbac-selected-card" : ""}`}>
              <div className="admin-list-card-header">
                <div>
                  <h3>{role.name}</h3>
                  <p>{role.slug}</p>
                </div>
                <button type="button" className="admin-secondary-btn" onClick={() => setSelectedRoleId(role.id)}>
                  查看
                </button>
              </div>
              <div className="admin-actions-row">
                <button type="button" className="admin-secondary-btn" onClick={() => void handleClone(role)}>
                  复制
                </button>
                {!role.isSystem ? (
                  <button type="button" className="admin-secondary-btn" onClick={() => void handleDisable(role)}>
                    禁用
                  </button>
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
