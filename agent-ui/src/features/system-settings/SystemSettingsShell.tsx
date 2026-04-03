import { useEffect, useState } from "react";
import { Alert, Button, Tabs, Typography } from "antd";

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

function formatLocalDateTime(value?: string | null) {
  if (!value) return "未记录";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "未记录";
  return parsed.toLocaleString();
}

function formatStorageLimit(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未设置";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function isPayloadSectionChanged(left: unknown, right: unknown) {
  if (right == null) return true;
  return JSON.stringify(left) !== JSON.stringify(right);
}

function applySystemSettingsResponse(
  response: {
    draft: SystemSettingsVersionRecord;
    published: SystemSettingsVersionRecord | null;
    draftMeta: SystemSettingsVersionMeta;
    publishedMeta: SystemSettingsVersionMeta | null;
  },
  setters: {
    setDraftRecord(next: SystemSettingsVersionRecord): void;
    setPublishedRecord(next: SystemSettingsVersionRecord | null): void;
    setDraftMeta(next: SystemSettingsVersionMeta): void;
    setPublishedMeta(next: SystemSettingsVersionMeta | null): void;
  }
) {
  setters.setDraftRecord(cloneRecord(response.draft));
  setters.setPublishedRecord(response.published ? cloneRecord(response.published) : null);
  setters.setDraftMeta(response.draftMeta);
  setters.setPublishedMeta(response.publishedMeta);
}

export function SystemSettingsShell() {
  const [section, setSection] = useState<SystemSettingsSection>("branding");
  const [draftRecord, setDraftRecord] = useState<SystemSettingsVersionRecord | null>(null);
  const [publishedRecord, setPublishedRecord] = useState<SystemSettingsVersionRecord | null>(null);
  const [draftMeta, setDraftMeta] = useState<SystemSettingsVersionMeta | null>(null);
  const [publishedMeta, setPublishedMeta] = useState<SystemSettingsVersionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErrorText, setLoadErrorText] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SystemSettingsFieldErrors>({});

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setLoadErrorText("");
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
          setLoadErrorText(getValidationMessage(error));
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

  async function reloadSettings() {
    setLoading(true);
    setLoadErrorText("");
    setErrorText("");
    setSuccessText("");
    setFieldErrors({});
    try {
      const response = await fetchSystemSettings();
      setDraftRecord(cloneRecord(response.draft));
      setPublishedRecord(response.published ? cloneRecord(response.published) : null);
      setDraftMeta(response.draftMeta);
      setPublishedMeta(response.publishedMeta);
    } catch (error) {
      setLoadErrorText(getValidationMessage(error));
    } finally {
      setLoading(false);
    }
  }

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

  async function persistDraft(options?: { successText?: string }) {
    if (!draftRecord || loading || saving || publishing) return false;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await saveSystemSettingsDraft(draftRecord.payload);
      applySystemSettingsResponse(response, {
        setDraftRecord: setDraftRecord,
        setPublishedRecord: setPublishedRecord,
        setDraftMeta: setDraftMeta,
        setPublishedMeta: setPublishedMeta
      });
      setFieldErrors({});
      if (options?.successText) {
        setSuccessText(options.successText);
      }
      return true;
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
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    await persistDraft({ successText: "草稿已保存" });
  }

  async function handlePublish() {
    if (!draftRecord || loading || saving || publishing) return;
    setPublishing(true);
    setErrorText("");
    setSuccessText("");
    try {
      const saved = await persistDraft();
      if (!saved) {
        return;
      }
      const response = await publishSystemSettings();
      applySystemSettingsResponse(response, {
        setDraftRecord: setDraftRecord,
        setPublishedRecord: setPublishedRecord,
        setDraftMeta: setDraftMeta,
        setPublishedMeta: setPublishedMeta
      });
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

  if (loading && !draftRecord && !loadErrorText) {
    return (
      <section className="admin-card">
        <p>加载系统设置中...</p>
      </section>
    );
  }

  if (loadErrorText && !draftRecord) {
    return (
      <section className="admin-card system-settings-shell">
        <div className="admin-section-header">
          <div>
            <p className="auth-eyebrow">Admin System Settings</p>
            <h2>系统设置</h2>
            <p>编辑平台默认值和安全边界，保存到草稿后再显式发布。</p>
          </div>
        </div>

        <div className="system-settings-load-error">
          <p className="err-text">系统设置加载失败</p>
          <p>{loadErrorText}</p>
          <button type="button" className="admin-action-btn" disabled={loading} onClick={() => void reloadSettings()}>
            {loading ? "重试中..." : "重试加载"}
          </button>
        </div>
      </section>
    );
  }

  if (!draftRecord || !draftMeta) {
    return (
      <section className="admin-card">
        <p>系统设置暂不可用</p>
      </section>
    );
  }

  const draftPayload = draftRecord.payload;
  const publishedPayload = publishedRecord?.payload ?? null;
  const changedAreas = [
    { label: "品牌与文案", changed: isPayloadSectionChanged(draftPayload.branding, publishedPayload?.branding) },
    { label: "模型默认值", changed: isPayloadSectionChanged(draftPayload.platformDefaults, publishedPayload?.platformDefaults) },
    { label: "保留与上传", changed: isPayloadSectionChanged({ retention: draftPayload.retention, uploads: draftPayload.uploads }, publishedPayload ? { retention: publishedPayload.retention, uploads: publishedPayload.uploads } : null) },
    { label: "安全策略", changed: isPayloadSectionChanged(draftPayload.safety, publishedPayload?.safety) },
    {
      label: "组织默认值",
      changed: isPayloadSectionChanged(draftPayload.organizationDefaults, publishedPayload?.organizationDefaults)
    },
    { label: "行为文案", changed: isPayloadSectionChanged(draftPayload.behavior, publishedPayload?.behavior) }
  ];
  const changedAreaCount = changedAreas.filter((item) => item.changed).length;
  const enabledSafetyRuleCount = Object.values(draftPayload.safety).filter(Boolean).length;
  const currentSectionLabel = SECTIONS.find((item) => item.id === section)?.label ?? section;

  return (
    <section className="admin-card system-settings-shell">
      <section className="admin-flagship-surface system-settings-command">
        <div className="admin-flagship-top">
          <div className="admin-flagship-copy">
            <p className="auth-eyebrow">Control Surface</p>
            <Typography.Title level={3} className="admin-flagship-title">
              把系统设置变成一张可发布、可对照、可回溯的控制面。
            </Typography.Title>
            <Typography.Paragraph className="admin-flagship-detail">
              草稿、已发布版本和风险边界都应该在第一屏被看见。当前正在编辑“{currentSectionLabel}”，所有时间均跟随当前用户本地时区。
            </Typography.Paragraph>
            <div className="admin-flagship-pill-row">
              <span className="admin-console-pill">草稿 · {formatVersionLabel(draftMeta)}</span>
              <span className="admin-console-pill">{publishedMeta ? `已发布 · ${formatVersionLabel(publishedMeta)}` : "尚未发布"}</span>
              <span className="admin-console-pill neutral">
                {changedAreaCount > 0 ? `待发布变更 ${changedAreaCount} 项` : "草稿与线上一致"}
              </span>
            </div>
          </div>
          <div className="admin-flagship-actions">
            <Button disabled={loading || saving || publishing} onClick={() => void reloadSettings()}>
              重新加载
            </Button>
            <Button type="default" disabled={saving || publishing} onClick={() => void handleSaveDraft()}>
              {saving ? "保存中..." : "保存草稿"}
            </Button>
            <Button type="primary" disabled={saving || publishing} onClick={() => void handlePublish()}>
              {publishing ? "发布中..." : "发布设置"}
            </Button>
          </div>
        </div>

        <div className="admin-flagship-grid">
          <article className="admin-flagship-card emphasis">
            <span>草稿轨道</span>
            <strong>{formatVersionLabel(draftMeta)}</strong>
            <p>修订 {draftMeta.revision} · 最近保存于 {formatLocalDateTime(draftMeta.updatedAt)}</p>
          </article>
          <article className="admin-flagship-card">
            <span>发布轨道</span>
            <strong>{publishedMeta ? formatVersionLabel(publishedMeta) : "未发布"}</strong>
            <p>
              {publishedMeta
                ? `发布时间 ${formatLocalDateTime(publishedMeta.publishedAt || publishedMeta.updatedAt)}`
                : "当前还没有正式线上版本。"}
            </p>
          </article>
          <article className="admin-flagship-card">
            <span>待发布变更</span>
            <strong>{changedAreaCount}</strong>
            <p>
              {changedAreaCount > 0
                ? changedAreas.filter((item) => item.changed).map((item) => item.label).join("、")
                : "当前草稿与已发布版本一致。"}
            </p>
          </article>
          <article className="admin-flagship-card">
            <span>安全与配额</span>
            <strong>{enabledSafetyRuleCount}</strong>
            <p>
              启用中的安全护栏；总上传限额 {formatStorageLimit(draftPayload.uploads.maxTotalUploadBytes)}，组织同步间隔{" "}
              {draftPayload.organizationDefaults.orgSyncIntervalMinutes} 分钟。
            </p>
          </article>
        </div>
      </section>

      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

      <div className="system-settings-tabs-wrap">
        <Tabs
          activeKey={section}
          onChange={(key) => setSection(key as SystemSettingsSection)}
          items={SECTIONS.map((item) => ({
            key: item.id,
            label: item.label
          }))}
        />
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
        />
      ) : null}

      <section className="system-settings-preview-grid">
        <article className="system-settings-preview-card">
          <span className="system-settings-preview-kicker">Draft Snapshot</span>
          <h3>当前草稿预览</h3>
          <div className="system-settings-preview-stack">
            <div className="system-settings-preview-row">
              <span>平台名称</span>
              <strong>{draftPayload.branding.platformName}</strong>
            </div>
            <div className="system-settings-preview-row">
              <span>模型默认值</span>
              <strong>
                {draftPayload.platformDefaults.provider} / {draftPayload.platformDefaults.model}
              </strong>
            </div>
            <div className="system-settings-preview-row">
              <span>工作区根目录</span>
              <strong>{draftPayload.platformDefaults.sessionWorkspaceRoot}</strong>
            </div>
            <div className="system-settings-preview-row">
              <span>欢迎摘要</span>
              <strong>{draftPayload.behavior.welcomeSummary}</strong>
            </div>
          </div>
        </article>
        <article className="system-settings-preview-card">
          <span className="system-settings-preview-kicker">Published Snapshot</span>
          <h3>当前发布预览</h3>
          {publishedPayload ? (
            <div className="system-settings-preview-stack">
              <div className="system-settings-preview-row">
                <span>平台名称</span>
                <strong>{publishedPayload.branding.platformName}</strong>
              </div>
              <div className="system-settings-preview-row">
                <span>模型默认值</span>
                <strong>
                  {publishedPayload.platformDefaults.provider} / {publishedPayload.platformDefaults.model}
                </strong>
              </div>
              <div className="system-settings-preview-row">
                <span>工作区根目录</span>
                <strong>{publishedPayload.platformDefaults.sessionWorkspaceRoot}</strong>
              </div>
              <div className="system-settings-preview-row">
                <span>欢迎摘要</span>
                <strong>{publishedPayload.behavior.welcomeSummary}</strong>
              </div>
            </div>
          ) : (
            <p>尚未发布</p>
          )}
        </article>
      </section>
    </section>
  );
}

export default SystemSettingsShell;
