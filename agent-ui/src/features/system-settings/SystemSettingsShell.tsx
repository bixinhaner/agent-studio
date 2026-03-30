import { useEffect, useState } from "react";
import type { SystemSettingsPayload, SystemSettingsSection, SystemSettingsVersionMeta } from "./types";
import { fetchSystemSettings, publishSystemSettings, saveSystemSettingsDraft } from "./api";
import { BrandingSettingsView } from "./BrandingSettingsView";
import { ModelDefaultsView } from "./ModelDefaultsView";
import { OrganizationDefaultsView } from "./OrganizationDefaultsView";
import { PublishHistoryView } from "./PublishHistoryView";
import { RetentionUploadView } from "./RetentionUploadView";
import { SafetySettingsView } from "./SafetySettingsView";

const SECTIONS: Array<{ id: SystemSettingsSection; label: string }> = [
  { id: "branding", label: "基本设置" },
  { id: "model-defaults", label: "模型默认值" },
  { id: "retention-upload", label: "保留与上传" },
  { id: "safety", label: "安全策略" },
  { id: "organization-defaults", label: "组织默认值" },
  { id: "publish-history", label: "发布记录" }
];

function clonePayload(payload: SystemSettingsPayload) {
  return {
    branding: { ...payload.branding },
    platformDefaults: { ...payload.platformDefaults },
    retention: { ...payload.retention },
    uploads: { ...payload.uploads },
    safety: { ...payload.safety },
    organizationDefaults: { ...payload.organizationDefaults },
    behavior: { ...payload.behavior }
  };
}

function formatVersion(meta: SystemSettingsVersionMeta | null) {
  if (!meta) return "-";
  return `v${meta.versionNumber}`;
}

export function SystemSettingsShell() {
  const [section, setSection] = useState<SystemSettingsSection>("branding");
  const [draft, setDraft] = useState<SystemSettingsPayload | null>(null);
  const [published, setPublished] = useState<SystemSettingsPayload | null>(null);
  const [draftMeta, setDraftMeta] = useState<SystemSettingsVersionMeta | null>(null);
  const [publishedMeta, setPublishedMeta] = useState<SystemSettingsVersionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const response = await fetchSystemSettings();
        if (!active) return;
        setDraft(clonePayload(response.draft));
        setPublished(clonePayload(response.published));
        setDraftMeta(response.draftMeta);
        setPublishedMeta(response.publishedMeta);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载系统设置失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  function updateDraftBranding(patch: Partial<SystemSettingsPayload["branding"]>) {
    setDraft((current) => (current ? { ...current, branding: { ...current.branding, ...patch } } : current));
  }

  function updateDraftPlatformDefaults(patch: Partial<SystemSettingsPayload["platformDefaults"]>) {
    setDraft((current) => (current ? { ...current, platformDefaults: { ...current.platformDefaults, ...patch } } : current));
  }

  function updateDraftRetention(patch: Partial<SystemSettingsPayload["retention"]>) {
    setDraft((current) => (current ? { ...current, retention: { ...current.retention, ...patch } } : current));
  }

  function updateDraftUploads(patch: Partial<SystemSettingsPayload["uploads"]>) {
    setDraft((current) => (current ? { ...current, uploads: { ...current.uploads, ...patch } } : current));
  }

  function updateDraftSafety(patch: Partial<SystemSettingsPayload["safety"]>) {
    setDraft((current) => (current ? { ...current, safety: { ...current.safety, ...patch } } : current));
  }

  function updateDraftOrganization(patch: Partial<SystemSettingsPayload["organizationDefaults"]>) {
    setDraft((current) => (current ? { ...current, organizationDefaults: { ...current.organizationDefaults, ...patch } } : current));
  }

  function updateDraftBehavior(patch: Partial<SystemSettingsPayload["behavior"]>) {
    setDraft((current) => (current ? { ...current, behavior: { ...current.behavior, ...patch } } : current));
  }

  async function handleSaveDraft() {
    if (!draft) return;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await saveSystemSettingsDraft(draft);
      setDraft(clonePayload(response.draft));
      setPublished(clonePayload(response.published));
      setDraftMeta(response.draftMeta);
      setPublishedMeta(response.publishedMeta);
      setSuccessText("草稿已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存草稿失败");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await publishSystemSettings();
      setDraft(clonePayload(response.draft));
      setPublished(clonePayload(response.published));
      setDraftMeta(response.draftMeta);
      setPublishedMeta(response.publishedMeta);
      setSuccessText("设置已发布");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "发布系统设置失败");
    } finally {
      setPublishing(false);
    }
  }

  if (loading || !draft || !draftMeta) {
    return (
      <section className="admin-card">
        <p>加载系统设置中...</p>
      </section>
    );
  }

  return (
    <section className="admin-card system-settings-shell">
      <div className="admin-section-header">
        <div>
          <p className="auth-eyebrow">Admin System Settings</p>
          <h2>系统设置</h2>
          <p>编辑平台默认值和安全边界，保存到草稿后再显式发布。</p>
        </div>
        <div className="system-settings-meta-pill-group">
          <span className="system-settings-meta-pill">编辑中：{formatVersion(draftMeta)}</span>
          <span className="system-settings-meta-pill">已发布：{formatVersion(publishedMeta)}</span>
        </div>
      </div>

      {errorText ? <p className="err-text">{errorText}</p> : null}
      {successText ? <p className="resource-center-success">{successText}</p> : null}

      <div className="admin-nav" role="tablist" aria-label="系统设置分区">
        {SECTIONS.map((item) => {
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? "admin-nav-btn active" : "admin-nav-btn"}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {section === "branding" ? (
        <BrandingSettingsView
          value={draft.branding}
          behavior={draft.behavior}
          disabled={saving || publishing}
          onChange={updateDraftBranding}
          onBehaviorChange={updateDraftBehavior}
        />
      ) : null}
      {section === "model-defaults" ? <ModelDefaultsView value={draft.platformDefaults} disabled={saving || publishing} onChange={updateDraftPlatformDefaults} /> : null}
      {section === "retention-upload" ? (
        <RetentionUploadView
          retention={draft.retention}
          uploads={draft.uploads}
          disabled={saving || publishing}
          onRetentionChange={updateDraftRetention}
          onUploadsChange={updateDraftUploads}
        />
      ) : null}
      {section === "safety" ? <SafetySettingsView value={draft.safety} disabled={saving || publishing} onChange={updateDraftSafety} /> : null}
      {section === "organization-defaults" ? <OrganizationDefaultsView value={draft.organizationDefaults} disabled={saving || publishing} onChange={updateDraftOrganization} /> : null}
      {section === "publish-history" ? (
        <PublishHistoryView
          draftMeta={draftMeta}
          publishedMeta={publishedMeta}
          saving={saving}
          publishing={publishing}
          onSave={() => void handleSaveDraft()}
          onPublish={() => void handlePublish()}
        />
      ) : null}

      <section className="system-settings-preview-grid">
        <article className="system-settings-preview-card">
          <h3>当前草稿预览</h3>
          <p>{draft.branding.platformName}</p>
          <p>{draft.platformDefaults.provider} / {draft.platformDefaults.model}</p>
          <p>{draft.behavior.welcomeSummary}</p>
        </article>
        <article className="system-settings-preview-card">
          <h3>当前发布预览</h3>
          <p>{published?.branding.platformName || "-"}</p>
          <p>{published?.platformDefaults.provider || "-"} / {published?.platformDefaults.model || "-"}</p>
          <p>{published?.behavior.welcomeSummary || "-"}</p>
        </article>
      </section>
    </section>
  );
}

export default SystemSettingsShell;
