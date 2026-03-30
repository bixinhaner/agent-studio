import { useEffect, useState } from "react";

import { putSkillPackageItems, putSkillPackageRuntimeBindings, updateSkillPackage } from "./api";
import { CapabilityPolicyEditor } from "./CapabilityPolicyEditor";
import { SkillPackageItemEditor } from "./SkillPackageItemEditor";
import type { SkillPackageItemInput, SkillPackageRecord, UpdateSkillPackageInput } from "./types";

type SkillPackageDetailViewProps = {
  skillPackage: SkillPackageRecord;
  onSkillPackageUpdated: (skillPackage: SkillPackageRecord) => void;
};

type SkillPackageTab = "basic" | "bindings" | "policies";

const SKILL_PACKAGE_TABS: Array<{ id: SkillPackageTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" }
];

function toEditableItems(skillPackage: SkillPackageRecord): SkillPackageItemInput[] {
  return skillPackage.items.map((item) => ({
    capabilityKey: item.capabilityKey,
    description: item.description ?? "",
    runtimeBindings:
      item.runtimeBindings.length > 0
        ? item.runtimeBindings.map((binding) => ({
            runtimeType: binding.runtimeType,
            bindingType: binding.bindingType,
            bindingPayload: binding.bindingPayload
          }))
        : [{ runtimeType: "codex", bindingType: "config_fragment", bindingPayload: {} }]
  }));
}

export function SkillPackageDetailView({ skillPackage, onSkillPackageUpdated }: SkillPackageDetailViewProps) {
  const [activeTab, setActiveTab] = useState<SkillPackageTab>("basic");
  const [name, setName] = useState(skillPackage.name);
  const [slug, setSlug] = useState(skillPackage.slug);
  const [description, setDescription] = useState(skillPackage.description || "");
  const [status, setStatus] = useState(skillPackage.status);
  const [visibleToUsers, setVisibleToUsers] = useState(skillPackage.visibleToUsers);
  const [items, setItems] = useState<SkillPackageItemInput[]>(() => toEditableItems(skillPackage));
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    setActiveTab("basic");
    setName(skillPackage.name);
    setSlug(skillPackage.slug);
    setDescription(skillPackage.description || "");
    setStatus(skillPackage.status);
    setVisibleToUsers(skillPackage.visibleToUsers);
    setItems(toEditableItems(skillPackage));
    setErrorText("");
    setSuccessText("");
  }, [skillPackage]);

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");

    const metadataPayload: UpdateSkillPackageInput = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      status,
      visibleToUsers
    };

    try {
      await updateSkillPackage(skillPackage.id, metadataPayload);
      await putSkillPackageItems(skillPackage.id, items);
      const response = await putSkillPackageRuntimeBindings(skillPackage.id, items);
      onSkillPackageUpdated(response.skillPackage);
      setSuccessText("技能包已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存技能包失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="resource-center-detail-stack">
      <section className="resource-center-section capability-center-summary">
        <div className="resource-center-section-header">
          <div>
            <h3>{skillPackage.name}</h3>
            <p>维护技能包元数据、结构化能力项和运行绑定。</p>
          </div>
          <span className={status === "active" ? "resource-center-badge" : "resource-center-badge muted"}>{status}</span>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="技能包详情标签">
          {SKILL_PACKAGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "capability-center-detail-tab active" : "capability-center-detail-tab"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {errorText ? <p className="err-text">{errorText}</p> : null}
        {successText ? <p className="resource-center-success">{successText}</p> : null}

        {activeTab === "basic" ? (
          <>
            <div className="resource-center-form-grid">
              <label className="field">
                <span className="field-label">技能包名称</span>
                <input className="field-input" aria-label="技能包名称" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
              </label>

              <label className="field">
                <span className="field-label">技能包 slug</span>
                <input className="field-input" aria-label="技能包 slug" value={slug} disabled={saving} onChange={(event) => setSlug(event.target.value)} />
              </label>

              <label className="field resource-center-form-span-2">
                <span className="field-label">技能包描述</span>
                <textarea
                  className="field-input textarea"
                  aria-label="技能包描述"
                  value={description}
                  disabled={saving}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="field-label">技能包状态</span>
                <select className="field-input" aria-label="技能包状态" value={status} disabled={saving} onChange={(event) => setStatus(event.target.value)}>
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">对用户可见</span>
                <select
                  className="field-input"
                  aria-label="对用户可见"
                  value={visibleToUsers ? "visible" : "hidden"}
                  disabled={saving}
                  onChange={(event) => setVisibleToUsers(event.target.value === "visible")}
                >
                  <option value="hidden">hidden</option>
                  <option value="visible">visible</option>
                </select>
              </label>
            </div>

            <div className="resource-center-actions">
              <button type="button" className="admin-action-btn" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中..." : "保存技能包"}
              </button>
            </div>
          </>
        ) : null}

        {activeTab === "bindings" ? (
          <>
            <SkillPackageItemEditor items={items} onChange={setItems} disabled={saving} />

            <div className="resource-center-actions">
              <button type="button" className="admin-action-btn" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中..." : "保存技能包"}
              </button>
            </div>
          </>
        ) : null}

        {activeTab === "policies" ? (
          <CapabilityPolicyEditor resourceType="skill_package" resourceId={skillPackage.id} title="技能包授权" />
        ) : null}
      </section>
    </div>
  );
}
