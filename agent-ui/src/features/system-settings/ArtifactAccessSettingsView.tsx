import { useMemo, useState } from "react";
import { Button, Switch, Tag } from "antd";
import { FileCheck2, LockKeyhole, Plus, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";

import type {
  SystemSettingsArtifactAccess,
  SystemSettingsArtifactAccessRule,
  SystemSettingsFieldErrors
} from "./types";
import { getFieldError } from "./validation";

type ArtifactAccessSettingsViewProps = {
  value: SystemSettingsArtifactAccess;
  fieldErrors: SystemSettingsFieldErrors;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsArtifactAccess>): void;
};

const SUBJECT_TYPE_OPTIONS: Array<{ value: SystemSettingsArtifactAccessRule["subjectType"]; label: string; hint: string }> = [
  { value: "user_type", label: "用户类型", hint: "external_user / internal_employee" },
  { value: "organization", label: "组织", hint: "组织 ID" },
  { value: "role", label: "角色", hint: "角色 ID 或角色名" },
  { value: "membership_type", label: "成员类型", hint: "成员关系类型" },
  { value: "department", label: "部门", hint: "部门 ID" },
  { value: "user", label: "指定用户", hint: "用户 ID" }
];

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bytesToMb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.round((value / 1024 / 1024) * 10) / 10);
}

function mbToBytes(value: string): number {
  return Math.max(1, Math.round(toNumber(value) * 1024 * 1024));
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed === "*") return "*";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function parseExtensions(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value.split(/[\s,，;；]+/g)) {
    const normalized = normalizeExtension(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function formatRuleSubject(rule: SystemSettingsArtifactAccessRule): string {
  const type = SUBJECT_TYPE_OPTIONS.find((item) => item.value === rule.subjectType)?.label ?? rule.subjectType;
  return `${type}: ${rule.subjectId || "未填写"}`;
}

function createRuleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `artifact-rule-${Date.now()}`;
}

export function ArtifactAccessSettingsView({ value, fieldErrors, disabled, onChange }: ArtifactAccessSettingsViewProps) {
  const [extensionDraft, setExtensionDraft] = useState("");
  const maxFileBytesError = getFieldError(fieldErrors, "artifactAccess.maxFileBytes");
  const retentionDaysError = getFieldError(fieldErrors, "artifactAccess.retentionDays");
  const allowedExtensionsError = getFieldError(fieldErrors, "artifactAccess.allowedExtensions");
  const rules = value.rules ?? [];
  const summaryItems = useMemo(
    () => [
      { label: "预览", value: value.enabled && value.previewEnabled ? "允许" : "关闭" },
      { label: "下载", value: value.enabled && value.downloadEnabled ? "允许" : "关闭" },
      { label: "单文件", value: `${bytesToMb(value.maxFileBytes)} MB` },
      { label: "保留", value: `${value.retentionDays} 天` }
    ],
    [value.downloadEnabled, value.enabled, value.maxFileBytes, value.previewEnabled, value.retentionDays]
  );

  function updateExtensions(nextItems: string[]) {
    const seen = new Set<string>();
    const allowedExtensions = nextItems
      .map(normalizeExtension)
      .filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
      });
    onChange({ allowedExtensions });
  }

  function commitExtensionDraft() {
    const parsed = parseExtensions(extensionDraft);
    if (parsed.length === 0) return;
    updateExtensions([...(value.allowedExtensions ?? []), ...parsed]);
    setExtensionDraft("");
  }

  function updateRule(index: number, patch: Partial<SystemSettingsArtifactAccessRule>) {
    onChange({
      rules: rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule))
    });
  }

  function addRule() {
    onChange({
      rules: [
        ...rules,
        {
          id: createRuleId(),
          label: "外部用户规则",
          subjectType: "user_type",
          subjectId: "external_user",
          enabled: value.enabled,
          previewEnabled: value.previewEnabled,
          downloadEnabled: value.downloadEnabled,
          autoRegisterGeneratedFiles: value.autoRegisterGeneratedFiles
        }
      ]
    });
  }

  function removeRule(index: number) {
    onChange({ rules: rules.filter((_, ruleIndex) => ruleIndex !== index) });
  }

  return (
    <div className="artifact-access-settings">
      <section className="artifact-access-hero">
        <div className="artifact-access-hero-main">
          <div className={value.enabled ? "artifact-access-status is-on" : "artifact-access-status"}>
            <ShieldCheck size={18} />
            <span>{value.enabled ? "外部 artifact 通道已开启" : "外部 artifact 通道未开启"}</span>
          </div>
          <h3>外部用户文件预览与下载</h3>
          <p>外部用户只能访问 agent 本轮生成并通过策略登记的 artifact；普通工作区路径仍不会直接暴露。</p>
        </div>
        <div className="artifact-access-summary-grid">
          {summaryItems.map((item) => (
            <div key={item.label} className="artifact-access-summary-item">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="resource-center-section artifact-access-panel">
        <div className="resource-center-section-header">
          <div>
            <h3>默认能力</h3>
            <p>先控制外部用户整体能不能看到 artifact，再分别控制预览、下载和自动登记。</p>
          </div>
          <FileCheck2 size={20} />
        </div>

        <div className="system-settings-toggle-grid artifact-access-toggle-grid">
          <label className="field checkbox-field system-settings-toggle-row">
            <Switch checked={value.enabled} disabled={disabled} onChange={(checked) => onChange({ enabled: checked })} />
            <span>
              <span className="field-label">开启外部 artifact 通道</span>
              <span className="field-help">关闭后，外部用户即使看到文件卡片，也不能预览或下载工作区文件。</span>
            </span>
          </label>

          <label className="field checkbox-field system-settings-toggle-row">
            <Switch
              checked={value.previewEnabled}
              disabled={disabled || !value.enabled}
              onChange={(checked) => onChange({ previewEnabled: checked })}
            />
            <span>
              <span className="field-label">允许预览</span>
              <span className="field-help">只对已登记且状态为 ready 的 artifact 生效。</span>
            </span>
          </label>

          <label className="field checkbox-field system-settings-toggle-row">
            <Switch
              checked={value.downloadEnabled}
              disabled={disabled || !value.enabled}
              onChange={(checked) => onChange({ downloadEnabled: checked })}
            />
            <span>
              <span className="field-label">允许下载</span>
              <span className="field-help">下载走单独接口审计，不复用预览生成的临时 blob。</span>
            </span>
          </label>

          <label className="field checkbox-field system-settings-toggle-row">
            <Switch
              checked={value.autoRegisterGeneratedFiles}
              disabled={disabled || !value.enabled}
              onChange={(checked) => onChange({ autoRegisterGeneratedFiles: checked })}
            />
            <span>
              <span className="field-label">自动登记 agent 生成文件</span>
              <span className="field-help">每轮结束后，把 file_change 中的文件纳入白名单并执行大小、类型和敏感内容检查。</span>
            </span>
          </label>
        </div>
      </section>

      <section className="resource-center-section artifact-access-panel">
        <div className="resource-center-section-header">
          <div>
            <h3>安全拦截</h3>
            <p>这些开关用于挡住隐藏路径、上传源文件、知识库原文复制和疑似密钥。</p>
          </div>
          <LockKeyhole size={20} />
        </div>

        <div className="system-settings-toggle-grid artifact-access-toggle-grid">
          <label className="field checkbox-field system-settings-toggle-row">
            <Switch
              checked={value.blockHiddenPaths}
              disabled={disabled}
              onChange={(checked) => onChange({ blockHiddenPaths: checked })}
            />
            <span>
              <span className="field-label">阻止隐藏路径</span>
              <span className="field-help">拦截 .env、.git、.config 等隐藏目录或隐藏文件。</span>
            </span>
          </label>

          <label className="field checkbox-field system-settings-toggle-row">
            <Switch
              checked={value.blockUserUploadDirectory}
              disabled={disabled}
              onChange={(checked) => onChange({ blockUserUploadDirectory: checked })}
            />
            <span>
              <span className="field-label">阻止 .uploads 源文件</span>
              <span className="field-help">用户上传的原始附件不会被 agent 直接发布成可下载 artifact。</span>
            </span>
          </label>

          <label className="field checkbox-field system-settings-toggle-row">
            <Switch
              checked={value.blockKnowledgeSetCopies}
              disabled={disabled}
              onChange={(checked) => onChange({ blockKnowledgeSetCopies: checked })}
            />
            <span>
              <span className="field-label">阻止知识库源文件复制</span>
              <span className="field-help">通过 checksum 拦截与托管知识库源文件完全一致的输出文件。</span>
            </span>
          </label>

          <label className="field checkbox-field system-settings-toggle-row">
            <Switch
              checked={value.secretScanEnabled}
              disabled={disabled}
              onChange={(checked) => onChange({ secretScanEnabled: checked })}
            />
            <span>
              <span className="field-label">扫描疑似密钥</span>
              <span className="field-help">对文本类 artifact 检查 private key、token、password 等高风险片段。</span>
            </span>
          </label>
        </div>
      </section>

      <section className="resource-center-section artifact-access-panel">
        <div className="resource-center-section-header">
          <div>
            <h3>大小、保留与文件类型</h3>
            <p>用白名单控制 artifact 的文件形态，减少误发布和大文件带来的风险。</p>
          </div>
          <SlidersHorizontal size={20} />
        </div>

        <div className="resource-center-form-grid">
          <label className="field">
            <span className="field-label">单个 artifact 上限（MB）</span>
            <input
              className="field-input"
              type="number"
              min={1}
              step={1}
              value={bytesToMb(value.maxFileBytes)}
              aria-invalid={Boolean(maxFileBytesError)}
              disabled={disabled}
              onChange={(event) => onChange({ maxFileBytes: mbToBytes(event.target.value) })}
            />
            {maxFileBytesError ? <p className="field-error">{maxFileBytesError}</p> : null}
          </label>

          <label className="field">
            <span className="field-label">artifact 保留天数</span>
            <input
              className="field-input"
              type="number"
              min={1}
              value={value.retentionDays}
              aria-invalid={Boolean(retentionDaysError)}
              disabled={disabled}
              onChange={(event) => onChange({ retentionDays: Math.max(1, Math.floor(toNumber(event.target.value))) })}
            />
            {retentionDaysError ? <p className="field-error">{retentionDaysError}</p> : null}
          </label>

          <div className="field resource-center-form-span-2">
            <span className="field-label">允许文件类型</span>
            <div className="artifact-extension-chip-list">
              {(value.allowedExtensions ?? []).map((extension) => (
                <Tag
                  key={extension}
                  closable={!disabled}
                  onClose={(event) => {
                    event.preventDefault();
                    updateExtensions((value.allowedExtensions ?? []).filter((item) => item !== extension));
                  }}
                >
                  {extension}
                </Tag>
              ))}
            </div>
            <div className="artifact-extension-input-row">
              <input
                className="field-input"
                value={extensionDraft}
                placeholder="输入 .pdf、xlsx、csv；输入 * 表示不限类型"
                disabled={disabled}
                onChange={(event) => setExtensionDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== ",") return;
                  event.preventDefault();
                  commitExtensionDraft();
                }}
                onBlur={commitExtensionDraft}
              />
              <Button disabled={disabled || !extensionDraft.trim()} onClick={commitExtensionDraft}>
                添加
              </Button>
            </div>
            {allowedExtensionsError ? <p className="field-error">{allowedExtensionsError}</p> : null}
          </div>
        </div>
      </section>

      <section className="resource-center-section artifact-access-panel">
        <div className="resource-center-section-header">
          <div>
            <h3>用户群定制规则</h3>
            <p>默认策略先覆盖所有外部用户；这里可以按用户类型、组织、角色、部门或指定用户做覆盖。</p>
          </div>
          <Button icon={<Plus size={15} />} disabled={disabled} onClick={addRule}>
            新增规则
          </Button>
        </div>

        {rules.length === 0 ? (
          <div className="artifact-rule-empty">
            <strong>当前没有定制规则</strong>
            <span>系统会使用上方默认策略。需要给某个用户群开放下载或收紧预览时，再新增覆盖规则。</span>
          </div>
        ) : (
          <div className="artifact-rule-list">
            {rules.map((rule, index) => {
              const subjectOption = SUBJECT_TYPE_OPTIONS.find((item) => item.value === rule.subjectType);
              return (
                <details key={rule.id || `${rule.subjectType}-${rule.subjectId}-${index}`} className="artifact-rule-card">
                  <summary>
                    <span>
                      <strong>{rule.label || "未命名规则"}</strong>
                      <small>{formatRuleSubject(rule)}</small>
                    </span>
                    <Tag color={rule.enabled === false ? "default" : "processing"}>
                      {rule.enabled === false ? "关闭" : "覆盖默认策略"}
                    </Tag>
                  </summary>
                  <div className="artifact-rule-editor-grid">
                    <label className="field">
                      <span className="field-label">规则名称</span>
                      <input
                        className="field-input"
                        value={rule.label ?? ""}
                        disabled={disabled}
                        onChange={(event) => updateRule(index, { label: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">匹配对象</span>
                      <select
                        className="field-input"
                        value={rule.subjectType}
                        disabled={disabled}
                        onChange={(event) =>
                          updateRule(index, { subjectType: event.target.value as SystemSettingsArtifactAccessRule["subjectType"] })
                        }
                      >
                        {SUBJECT_TYPE_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <span className="field-help">{subjectOption?.hint}</span>
                    </label>
                    <label className="field">
                      <span className="field-label">对象 ID / 值</span>
                      <input
                        className="field-input"
                        value={rule.subjectId}
                        disabled={disabled}
                        onChange={(event) => updateRule(index, { subjectId: event.target.value })}
                      />
                    </label>
                    <div className="artifact-rule-switches">
                      <label>
                        <Switch
                          size="small"
                          checked={rule.enabled ?? value.enabled}
                          disabled={disabled}
                          onChange={(checked) => updateRule(index, { enabled: checked })}
                        />
                        <span>启用</span>
                      </label>
                      <label>
                        <Switch
                          size="small"
                          checked={rule.previewEnabled ?? value.previewEnabled}
                          disabled={disabled}
                          onChange={(checked) => updateRule(index, { previewEnabled: checked })}
                        />
                        <span>预览</span>
                      </label>
                      <label>
                        <Switch
                          size="small"
                          checked={rule.downloadEnabled ?? value.downloadEnabled}
                          disabled={disabled}
                          onChange={(checked) => updateRule(index, { downloadEnabled: checked })}
                        />
                        <span>下载</span>
                      </label>
                      <label>
                        <Switch
                          size="small"
                          checked={rule.autoRegisterGeneratedFiles ?? value.autoRegisterGeneratedFiles}
                          disabled={disabled}
                          onChange={(checked) => updateRule(index, { autoRegisterGeneratedFiles: checked })}
                        />
                        <span>自动登记</span>
                      </label>
                    </div>
                    <div className="artifact-rule-actions">
                      <Button danger icon={<Trash2 size={15} />} disabled={disabled} onClick={() => removeRule(index)}>
                        删除规则
                      </Button>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
