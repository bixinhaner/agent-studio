import { useEffect, useState } from "react";
import { Alert, Button, Tabs, Typography, Tag, Space, Spin } from "antd";
import { Settings2, HardDrive, ShieldCheck, Users, Box, History, Save, Send } from "lucide-react";

import { fetchSystemSettings, publishSystemSettings, saveSystemSettingsDraft, uploadSystemSettingsBrandingAsset, type BrandingAssetKind } from "./api";
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

const SECTIONS: Array<{ id: SystemSettingsSection; label: string; icon: any; group: string }> = [
  { id: "branding", label: "基本设置", icon: Settings2, group: 'General' },
  { id: "model-defaults", label: "运行时默认与兜底", icon: Box, group: 'General' },
  { id: "organization-defaults", label: "组织默认值", icon: Users, group: 'General' },
  { id: "retention-upload", label: "保留与上传", icon: HardDrive, group: 'Security & Data' },
  { id: "safety", label: "安全策略", icon: ShieldCheck, group: 'Security & Data' },
  { id: "publish-history", label: "发布记录", icon: History, group: 'System' }
];

function clonePayload(payload: SystemSettingsPayload): SystemSettingsPayload {
  return {
    branding: { ...payload.branding },
    platformDefaults: { ...payload.platformDefaults },
    retention: { ...payload.retention },
    uploads: { ...payload.uploads },
    safety: { ...payload.safety },
    organizationDefaults: { ...payload.organizationDefaults },
    behavior: {
      ...payload.behavior,
      portalWelcomeSuggestions: payload.behavior.portalWelcomeSuggestions.map((item) => ({ ...item }))
    }
  };
}

function cloneRecord(record: SystemSettingsVersionRecord): SystemSettingsVersionRecord {
  return { ...record, payload: clonePayload(record.payload) };
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
      try {
        const response = await fetchSystemSettings();
        if (!active) return;
        setDraftRecord(cloneRecord(response.draft));
        setPublishedRecord(response.published ? cloneRecord(response.published) : null);
        setDraftMeta(response.draftMeta);
        setPublishedMeta(response.publishedMeta);
      } catch (error) {
        if (active) setLoadErrorText(getValidationMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
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
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${path}.`)) {
            delete next[key];
          }
        }
      }
      return next;
    });
  }

  function updateDraftBranding(patch: Partial<SystemSettingsPayload["branding"]>) {
    updateDraft(c => ({ ...c, payload: { ...c.payload, branding: { ...c.payload.branding, ...patch } } }), fieldPaths("branding", patch));
  }

  function updateDraftPlatformDefaults(patch: Partial<SystemSettingsPayload["platformDefaults"]>) {
    updateDraft(c => ({ ...c, payload: { ...c.payload, platformDefaults: { ...c.payload.platformDefaults, ...patch } } }), fieldPaths("platformDefaults", patch));
  }

  function updateDraftRetention(patch: Partial<SystemSettingsPayload["retention"]>) {
    updateDraft(c => ({ ...c, payload: { ...c.payload, retention: { ...c.payload.retention, ...patch } } }), fieldPaths("retention", patch));
  }

  function updateDraftUploads(patch: Partial<SystemSettingsPayload["uploads"]>) {
    updateDraft(c => ({ ...c, payload: { ...c.payload, uploads: { ...c.payload.uploads, ...patch } } }), fieldPaths("uploads", patch));
  }

  function updateDraftSafety(patch: Partial<SystemSettingsPayload["safety"]>) {
    updateDraft(c => ({ ...c, payload: { ...c.payload, safety: { ...c.payload.safety, ...patch } } }), fieldPaths("safety", patch));
  }

  function updateDraftOrganization(patch: Partial<SystemSettingsPayload["organizationDefaults"]>) {
    updateDraft(c => ({ ...c, payload: { ...c.payload, organizationDefaults: { ...c.payload.organizationDefaults, ...patch } } }), fieldPaths("organizationDefaults", patch));
  }

  function updateDraftBehavior(patch: Partial<SystemSettingsPayload["behavior"]>) {
    updateDraft(c => ({ ...c, payload: { ...c.payload, behavior: { ...c.payload.behavior, ...patch } } }), fieldPaths("behavior", patch));
  }

  async function uploadBrandingAsset(kind: BrandingAssetKind, file: File): Promise<string> {
    const asset = await uploadSystemSettingsBrandingAsset(kind, file);
    return asset.url;
  }

  async function persistDraft(options?: { successText?: string }) {
    if (!draftRecord || loading || saving || publishing) return false;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await saveSystemSettingsDraft(draftRecord.payload);
      applySystemSettingsResponse(response, { setDraftRecord, setPublishedRecord, setDraftMeta, setPublishedMeta });
      setFieldErrors({});
      if (options?.successText) setSuccessText(options.successText);
      return true;
    } catch (error) {
      const message = getValidationMessage(error);
      const parsed = parseSystemSettingsValidationDetail(message);
      if (Object.keys(parsed.fieldErrors).length > 0) {
        setFieldErrors(parsed.fieldErrors);
        const nextSection = firstSectionWithFieldErrors(parsed.fieldErrors);
        if (nextSection) setSection(nextSection);
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
      if (!saved) return;
      const response = await publishSystemSettings();
      applySystemSettingsResponse(response, { setDraftRecord, setPublishedRecord, setDraftMeta, setPublishedMeta });
      setFieldErrors({});
      setSuccessText("设置已发布");
    } catch (error) {
      const message = getValidationMessage(error);
      const parsed = parseSystemSettingsValidationDetail(message);
      if (Object.keys(parsed.fieldErrors).length > 0) {
        setFieldErrors(parsed.fieldErrors);
        const nextSection = firstSectionWithFieldErrors(parsed.fieldErrors);
        if (nextSection) setSection(nextSection);
        setErrorText(parsed.summary);
      } else {
        setErrorText(message);
      }
    } finally {
      setPublishing(false);
    }
  }

  if (loading && !draftRecord && !loadErrorText) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}><Spin size="large" /></div>;
  }

  if (loadErrorText && !draftRecord) {
    return (
      <div className="admin-card">
        <Typography.Title level={4}>系统配置</Typography.Title>
        <Alert type="error" message="加载失败" description={loadErrorText} showIcon style={{ marginBottom: 16 }} />
        <Button onClick={() => void reloadSettings()}>重试加载</Button>
      </div>
    );
  }

  if (!draftRecord || !draftMeta) return null;

  const draftPayload = draftRecord.payload;
  const publishedPayload = publishedRecord?.payload ?? null;
  const changedAreaCount = [
    isPayloadSectionChanged(draftPayload.branding, publishedPayload?.branding),
    isPayloadSectionChanged(draftPayload.platformDefaults, publishedPayload?.platformDefaults),
    isPayloadSectionChanged({ retention: draftPayload.retention, uploads: draftPayload.uploads }, publishedPayload ? { retention: publishedPayload.retention, uploads: publishedPayload.uploads } : null),
    isPayloadSectionChanged(draftPayload.safety, publishedPayload?.safety),
    isPayloadSectionChanged(draftPayload.organizationDefaults, publishedPayload?.organizationDefaults),
    isPayloadSectionChanged(draftPayload.behavior, publishedPayload?.behavior)
  ].filter(Boolean).length;

  const currentSectionItem = SECTIONS.find((item) => item.id === section);
  
  // Group SECTIONS
  const groups = Array.from(new Set(SECTIONS.map(s => s.group)));

  return (
    <div className="admin-settings-layout">
      {/* Sidebar Navigation (macOS System Settings Style) */}
      <div className="admin-settings-sidebar">
        {groups.map(group => (
          <div key={group} className="admin-settings-nav-group">
            <div className="admin-settings-nav-group-title">{group}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {SECTIONS.filter(s => s.group === group).map(item => {
                const Icon = item.icon;
                const isActive = section === item.id;
                return (
                  <button
                    key={item.id}
                    className={`admin-settings-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setSection(item.id)}
                  >
                    <div className="admin-settings-nav-icon">
                      <Icon size={16} />
                    </div>
                    <span style={{ fontWeight: isActive ? 500 : 400 }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="admin-settings-content">
        <div className="admin-settings-content-header">
          <div>
            <Typography.Title level={4} style={{ margin: '0 0 4px 0', fontSize: 20 }}>
              {currentSectionItem?.label}
            </Typography.Title>
            <Space size={16}>
              <span style={{ fontSize: 13, color: 'var(--admin-color-subtle)' }}>草稿 {formatVersionLabel(draftMeta)}</span>
              {publishedMeta && <span style={{ fontSize: 13, color: 'var(--admin-color-subtle)' }}>发布 {formatVersionLabel(publishedMeta)}</span>}
            </Space>
          </div>
          {changedAreaCount > 0 && (
            <Tag color="processing" style={{ borderRadius: 12 }}>
              有 {changedAreaCount} 项未发布变更
            </Tag>
          )}
        </div>

        <div className="admin-settings-content-scroll">
          {errorText && <Alert type="error" showIcon message={errorText} style={{ marginBottom: 24 }} closable onClose={() => setErrorText("")} />}
          {successText && <Alert type="success" showIcon message={successText} style={{ marginBottom: 24 }} closable onClose={() => setSuccessText("")} />}

          {section === "branding" && (
            <BrandingSettingsView
              value={draftPayload.branding}
              behavior={draftPayload.behavior}
              fieldErrors={fieldErrors}
              disabled={saving || publishing}
              onChange={updateDraftBranding}
              onBehaviorChange={updateDraftBehavior}
              onAssetUpload={uploadBrandingAsset}
            />
          )}
          {section === "model-defaults" && (
            <ModelDefaultsView value={draftPayload.platformDefaults} fieldErrors={fieldErrors} disabled={saving || publishing} onChange={updateDraftPlatformDefaults} />
          )}
          {section === "retention-upload" && (
            <RetentionUploadView retention={draftPayload.retention} uploads={draftPayload.uploads} fieldErrors={fieldErrors} disabled={saving || publishing} onRetentionChange={updateDraftRetention} onUploadsChange={updateDraftUploads} />
          )}
          {section === "safety" && (
            <SafetySettingsView value={draftPayload.safety} disabled={saving || publishing} onChange={updateDraftSafety} />
          )}
          {section === "organization-defaults" && (
            <OrganizationDefaultsView value={draftPayload.organizationDefaults} fieldErrors={fieldErrors} disabled={saving || publishing} onChange={updateDraftOrganization} />
          )}
          {section === "publish-history" && (
            <PublishHistoryView draftMeta={draftMeta} publishedMeta={publishedMeta} />
          )}
        </div>

        {/* Footer Actions */}
        <div className="admin-floating-action-bar">
          <div style={{ fontSize: 13, color: 'var(--admin-color-subtle)' }}>
            自动保存草稿于 {formatLocalDateTime(draftMeta.updatedAt)}
          </div>
          <Space>
            <Button disabled={loading || saving || publishing} onClick={reloadSettings}>
              放弃更改
            </Button>
            <Button 
              type="default" 
              icon={<Save size={16} />} 
              disabled={saving || publishing} 
              onClick={handleSaveDraft}
              loading={saving}
            >
              保存草稿
            </Button>
            <Button 
              type="primary" 
              icon={<Send size={16} />} 
              disabled={saving || publishing || changedAreaCount === 0} 
              onClick={handlePublish}
              loading={publishing}
            >
              应用并发布
            </Button>
          </Space>
        </div>
      </div>
    </div>
  );
}

export default SystemSettingsShell;
