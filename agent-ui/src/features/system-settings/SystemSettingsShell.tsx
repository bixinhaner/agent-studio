import { useEffect, useState } from "react";

import { fetchSystemSettings, publishSystemSettings, saveSystemSettingsDraft } from "./api";
import { BrandingSettingsView } from "./BrandingSettingsView";
import { ModelDefaultsView } from "./ModelDefaultsView";
import { OrganizationDefaultsView } from "./OrganizationDefaultsView";
import { PublishHistoryView } from "./PublishHistoryView";
import { RetentionUploadView } from "./RetentionUploadView";
import { SafetySettingsView } from "./SafetySettingsView";
import type {
  SystemSettingsFieldErrors,
  SystemSettingsPayload,
  SystemSettingsSection,
  SystemSettingsVersionMeta,
  SystemSettingsVersionRecord
} from "./types";
import { firstSectionWithFieldErrors, parseSystemSettingsValidationDetail } from "./validation";

const SECTIONS: Array<{ id: SystemSettingsSection; label: string }> = [
  { id: "branding", label: "基本设置" },
  { id: "model-defaults", label: "模型默认值" },
  { id: "retention-upload", label: "保留与上传" },
  { id: "safety", label: "安全策略" },
  { id: "organization-defaults", label: "组织默认值" },
  { id: "publish-history", label: "发布记录" }
];

function clonePayload(payload: SystemSettingsPayload): SystemSettingsPayload {
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

function cloneRecord(record: SystemSettingsVersionRecord): SystemSettingsVersionRecord {
  return {
    ...record,
    payload: clonePayload(record.payload)
  };
}

function formatVersionLabel(meta: SystemSettingsVersionMeta | null) {
  if (!meta) return "尚未发布";
  return `v${meta.versionNumber}`;
}

function fieldPaths(prefix: string, patch: Record<string, unknown>) {
  return Object.keys(patch).map((key) => `${prefix}.${key}`);
}

function getValidationMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "请求失败";
}

export function SystemSettingsShell() {
  const [section, setSection] = useState<SystemSettingsSection>("branding");
  const [draftRecord, setDraftRecord] = useState<SystemSettingsVersionRecord | null>(null);
  const [publishedRecord, setPublishedRecord] = useState<SystemSettingsVersionRecord | null>(null);
  const [draftMeta, setDraftMeta] = useState<SystemSettingsVersionMeta | null>(null);
  const [publishedMeta, setPublishedMeta] = useState<SystemSettingsVersionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SystemSettingsFieldErrors>({});

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      setSuccessText("");
      setFieldErrors({});
      try {
        const response = await fetchSystemSettings();
        if (!active) return;
        setDraftRecord(cloneRecord(response.draft));
        setPublishedRecord(response.published ? cloneRecord(response.published) : null);
        setDraftMeta(response.draftMeta);
        setPublishedMeta(response.publishedMeta);
      } catch (error) {
        if (active) {
          setErrorText(getValidationMessage(error));
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

  function updateDraft(
    updater: (current: SystemSettingsVersionRecord) => SystemSettingsVersionRecord,
    pathsToClear: string[]
  ) {
    setDraftRecord((current) => (current ? updater(current) : current));
    setErrorText("");
    setFieldErrors((current) => {
      if (pathsToClear.length === 0) return current;
      const next = { ...current };
      for (const path of pathsToClear) {
        delete next[path];
      }
      return next;
    });
  }

  function updateDraftBranding(patch: Partial<SystemSettingsPayload["branding"]>) {
    updateDraft(
      (current) => ({
        ...current,
        payload: {
          ...current.payload,
          branding: { ...current.payload.branding, ...patch }
        }
      }),
      fieldPaths("branding", patch as Record<string, unknown>)
    );
  }

  function updateDraftPlatformDefaults(patch: Partial<SystemSettingsPayload["platformDefaults"]>) {
    updateDraft(
      (current) => ({
        ...current,
        payload: {
          ...current.payload,
          platformDefaults: { ...current.payload.platformDefaults, ...patch }
        }
      }),
      fieldPaths("platformDefaults", patch as Record<string, unknown>)
    );
  }

  function updateDraftRetention(patch: Partial<SystemSettingsPayload["retention"]>) {
    updateDraft(
      (current) => ({
        ...current,
        payload: {
          ...current.payload,
          retention: { ...current.payload.retention, ...patch }
        }
      }),
      fieldPaths("retention", patch as Record<string, unknown>)
    );
  }

  function updateDraftUploads(patch: Partial<SystemSettingsPayload["uploads"]>) {
    updateDraft(
      (current) => ({
        ...current,
        payload: {
          ...current.payload,
          uploads: { ...current.payload.uploads, ...patch }
        }
      }),
      fieldPaths("uploads", patch as Record<string, unknown>)
    );
  }

  function updateDraftSafety(patch: Partial<SystemSettingsPayload["safety"]>) {
    updateDraft(
      (current) => ({
        ...current,
        payload: {
          ...current.payload,
          safety: { ...current.payload.safety, ...patch }
        }
      }),
      fieldPaths("safety", patch as Record<string, unknown>)
    );
  }

  function updateDraftOrganization(patch: Partial<SystemSettingsPayload["organizationDefaults"]>) {
    updateDraft(
      (current) => ({
        ...current,
        payload: {
          ...current.payload,
          organizationDefaults: { ...current.payload.organizationDefaults, ...patch }
        }
      }),
      fieldPaths("organizationDefaults", patch as Record<string, unknown>)
    );
  }

  function updateDraftBehavior(patch: Partial<SystemSettingsPayload["behavior"]>) {
    updateDraft(
      (current) => ({
        ...current,
        payload: {
          ...current.payload,
          behavior: { ...current.payload.behavior, ...patch }
        }
      }),
      fieldPaths("behavior", patch as Record<string, unknown>)
    );
  }

  async function handleSaveDraft() {
    if (!draftRecord) return;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await saveSystemSettingsDraft(draftRecord.payload);
      setDraftRecord(cloneRecord(response.draft));
      setPublishedRecord(response.published ? cloneRecord(response.published) : null);
      setDraftMeta(response.draftMeta);
      setPublishedMeta(response.publishedMeta);
      setFieldErrors({});
      setSuccessText("草稿已保存");
    } catch (error) {
      const message = getValidationMessage(error);
      const parsed = parseSystemSettingsValidationDetail(message);
      if (Object.keys(parsed.fieldErrors).length > 0) {
        setFieldErrors(parsed.fieldErrors);
        const nextSection = firstSectionWithFieldErrors(parsed.fieldErrors);
        if (nextSection) {
          setSection(nextSection);
        }
        setErrorText(parsed.summary);
      } else {
        setErrorText(message);
      }
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
      setDraftRecord(cloneRecord(response.draft));
      setPublishedRecord(response.published ? cloneRecord(response.published) : null);
      setDraftMeta(response.draftMeta);
      setPublishedMeta(response.publishedMeta);
      setFieldErrors({});
      setSuccessText("设置已发布");
    } catch (error) {
      const message = getValidationMessage(error);
      const parsed = parseSystemSettingsValidationDetail(message);
      if (Object.keys(parsed.fieldErrors).length > 0) {
        setFieldErrors(parsed.fieldErrors);
        const nextSection = firstSectionWithFieldErrors(parsed.fieldErrors);
        if (nextSection) {
          setSection(nextSection);
        }
        setErrorText(parsed.summary);
      } else {
        setErrorText(message);
      }
    } finally {
      setPublishing(false);
    }
  }

  if (loading || !draftRecord || !draftMeta) {
    return (
      <section className="admin-card">
        <p>加载系统设置中...</p>
      </section>
    );
  }

  const draftPayload = draftRecord.payload;
  const publishedPayload = publishedRecord?.payload ?? null;

  return (
    <section className="admin-card system-settings-shell">
      <div className="admin-section-header">
        <div>
          <p className="auth-eyebrow">Admin System Settings</p>
          <h2>系统设置</h2>
          <p>编辑平台默认值和安全边界，保存到草稿后再显式发布。</p>
        </div>
        <div className="system-settings-meta-pill-group">
          <span className="system-settings-meta-pill">编辑中：{formatVersionLabel(draftMeta)}</span>
          <span className="system-settings-meta-pill">已发布：{formatVersionLabel(publishedMeta)}</span>
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
          value={draftPayload.branding}
          behavior={draftPayload.behavior}
          fieldErrors={fieldErrors}
          disabled={saving || publishing}
          onChange={updateDraftBranding}
          onBehaviorChange={updateDraftBehavior}
        />
      ) : null}
      {section === "model-defaults" ? (
        <ModelDefaultsView value={draftPayload.platformDefaults} fieldErrors={fieldErrors} disabled={saving || publishing} onChange={updateDraftPlatformDefaults} />
      ) : null}
      {section === "retention-upload" ? (
        <RetentionUploadView
          retention={draftPayload.retention}
          uploads={draftPayload.uploads}
          fieldErrors={fieldErrors}
          disabled={saving || publishing}
          onRetentionChange={updateDraftRetention}
          onUploadsChange={updateDraftUploads}
        />
      ) : null}
      {section === "safety" ? <SafetySettingsView value={draftPayload.safety} disabled={saving || publishing} onChange={updateDraftSafety} /> : null}
      {section === "organization-defaults" ? (
        <OrganizationDefaultsView value={draftPayload.organizationDefaults} fieldErrors={fieldErrors} disabled={saving || publishing} onChange={updateDraftOrganization} />
      ) : null}
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
          <p>{draftPayload.branding.platformName}</p>
          <p>
            {draftPayload.platformDefaults.provider} / {draftPayload.platformDefaults.model}
          </p>
          <p>{draftPayload.behavior.welcomeSummary}</p>
        </article>
        <article className="system-settings-preview-card">
          <h3>当前发布预览</h3>
          {publishedPayload ? (
            <>
              <p>{publishedPayload.branding.platformName}</p>
              <p>
                {publishedPayload.platformDefaults.provider} / {publishedPayload.platformDefaults.model}
              </p>
              <p>{publishedPayload.behavior.welcomeSummary}</p>
            </>
          ) : (
            <p>尚未发布</p>
          )}
        </article>
      </section>
    </section>
  );
}

export default SystemSettingsShell;
