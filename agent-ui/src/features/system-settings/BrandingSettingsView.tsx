import { useState } from "react";
import { Button, Input, Upload } from "antd";

import { BrandMark, getBrandInitials } from "../branding/BrandMark";
import type { BrandingAssetKind } from "./api";
import type { SystemSettingsBehavior, SystemSettingsBranding, SystemSettingsFieldErrors } from "./types";
import { getFieldError } from "./validation";

type BrandingSettingsViewProps = {
  value: SystemSettingsBranding;
  behavior: SystemSettingsBehavior;
  fieldErrors: SystemSettingsFieldErrors;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsBranding>): void;
  onBehaviorChange(patch: Partial<SystemSettingsBehavior>): void;
  onAssetUpload(kind: BrandingAssetKind, file: File): Promise<string>;
};

const ASSET_ACCEPT = "image/png,image/jpeg,image/webp";

function fieldForAssetKind(kind: BrandingAssetKind): keyof Pick<SystemSettingsBranding, "logoUrl" | "iconUrl" | "assistantAvatarUrl"> {
  if (kind === "logo") return "logoUrl";
  if (kind === "icon") return "iconUrl";
  return "assistantAvatarUrl";
}

export function BrandingSettingsView({
  value,
  behavior,
  fieldErrors,
  disabled,
  onChange,
  onBehaviorChange,
  onAssetUpload
}: BrandingSettingsViewProps) {
  const { TextArea } = Input;
  const [uploadingKind, setUploadingKind] = useState<BrandingAssetKind | "">("");
  const [uploadErrorText, setUploadErrorText] = useState("");

  const platformNameError = getFieldError(fieldErrors, "branding.platformName");
  const headerSubtitleError = getFieldError(fieldErrors, "branding.headerSubtitle");
  const loginCopyError = getFieldError(fieldErrors, "branding.loginCopy");
  const logoUrlError = getFieldError(fieldErrors, "branding.logoUrl");
  const iconUrlError = getFieldError(fieldErrors, "branding.iconUrl");
  const assistantNameError = getFieldError(fieldErrors, "branding.assistantName");
  const assistantAvatarUrlError = getFieldError(fieldErrors, "branding.assistantAvatarUrl");
  const welcomeSummaryError = getFieldError(fieldErrors, "behavior.welcomeSummary");
  const usageSummaryError = getFieldError(fieldErrors, "behavior.usageSummary");
  const markdownError = getFieldError(fieldErrors, "behavior.markdown");

  async function uploadAsset(kind: BrandingAssetKind, file: File) {
    setUploadErrorText("");
    setUploadingKind(kind);
    try {
      const url = await onAssetUpload(kind, file);
      onChange({ [fieldForAssetKind(kind)]: url });
    } catch (error) {
      setUploadErrorText(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploadingKind("");
    }
  }

  function assetField(input: {
    label: string;
    value: string;
    error?: string;
    kind: BrandingAssetKind;
    placeholder: string;
    help: string;
  }) {
    const uploading = uploadingKind === input.kind;
    return (
      <label className="field branding-asset-field">
        <span className="field-label">{input.label}</span>
        <div className="branding-asset-input-row">
          <Input
            value={input.value}
            aria-invalid={Boolean(input.error)}
            disabled={disabled || uploading}
            placeholder={input.placeholder}
            onChange={(event) => onChange({ [fieldForAssetKind(input.kind)]: event.target.value })}
          />
          <Upload
            accept={ASSET_ACCEPT}
            maxCount={1}
            showUploadList={false}
            disabled={disabled || uploading}
            beforeUpload={(file) => {
              void uploadAsset(input.kind, file as File);
              return false;
            }}
          >
            <Button disabled={disabled || uploading} loading={uploading}>
              上传
            </Button>
          </Upload>
        </div>
        <span className="field-help">{input.help}</span>
        {input.error ? <p className="field-error">{input.error}</p> : null}
      </label>
    );
  }

  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>基本设置</h3>
          <p>维护品牌、登录页和行为说明，发布后会应用到用户侧界面。</p>
        </div>
      </div>

      <div className="branding-preview-grid">
        <article className="branding-preview-card">
          <span className="branding-preview-label">登录与导航</span>
          <div className="branding-preview-brand">
            <BrandMark className="branding-preview-logo" imageClassName="branding-preview-logo-image" name={value.platformName} logoUrl={value.logoUrl || value.iconUrl} />
            <div>
              <strong>{value.platformName || "平台名称"}</strong>
              <span>{value.headerSubtitle || "页眉副标题"}</span>
            </div>
          </div>
        </article>
        <article className="branding-preview-card">
          <span className="branding-preview-label">AI 机器人</span>
          <div className="branding-preview-brand">
            <BrandMark
              className="branding-preview-avatar"
              imageClassName="branding-preview-logo-image"
              name={value.assistantName || value.platformName}
              logoUrl={value.assistantAvatarUrl}
            />
            <div>
              <strong>{value.assistantName || "AI 机器人名称"}</strong>
              <span>备用缩写：{getBrandInitials(value.assistantName || value.platformName)}</span>
            </div>
          </div>
        </article>
      </div>

      {uploadErrorText ? <p className="field-error branding-upload-error">{uploadErrorText}</p> : null}

      <div className="resource-center-form-grid">
        <label className="field">
          <span className="field-label">平台名称</span>
          <Input
            value={value.platformName}
            aria-invalid={Boolean(platformNameError)}
            disabled={disabled}
            onChange={(event) => onChange({ platformName: event.target.value })}
          />
          {platformNameError ? <p className="field-error">{platformNameError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">页眉副标题</span>
          <Input
            value={value.headerSubtitle}
            aria-invalid={Boolean(headerSubtitleError)}
            disabled={disabled}
            onChange={(event) => onChange({ headerSubtitle: event.target.value })}
          />
          {headerSubtitleError ? <p className="field-error">{headerSubtitleError}</p> : null}
        </label>

        <label className="field resource-center-form-span-2">
          <span className="field-label">登录页文案</span>
          <TextArea
            autoSize={{ minRows: 3, maxRows: 7 }}
            value={value.loginCopy}
            aria-invalid={Boolean(loginCopyError)}
            disabled={disabled}
            onChange={(event) => onChange({ loginCopy: event.target.value })}
          />
          {loginCopyError ? <p className="field-error">{loginCopyError}</p> : null}
        </label>

        {assetField({
          label: "Logo",
          value: value.logoUrl,
          error: logoUrlError,
          kind: "logo",
          placeholder: "https://... 或 /public-api/...",
          help: "用于登录页和导航；支持 PNG、JPG、WebP 上传。"
        })}

        {assetField({
          label: "浏览器图标",
          value: value.iconUrl,
          error: iconUrlError,
          kind: "icon",
          placeholder: "https://... 或 /public-api/...",
          help: "用于 favicon 和小尺寸标识；建议使用方形图片。"
        })}

        <label className="field">
          <span className="field-label">AI 机器人名称</span>
          <Input
            value={value.assistantName}
            aria-invalid={Boolean(assistantNameError)}
            disabled={disabled}
            onChange={(event) => onChange({ assistantName: event.target.value })}
          />
          {assistantNameError ? <p className="field-error">{assistantNameError}</p> : null}
        </label>

        {assetField({
          label: "AI 机器人头像",
          value: value.assistantAvatarUrl,
          error: assistantAvatarUrlError,
          kind: "assistant-avatar",
          placeholder: "https://... 或 /public-api/...",
          help: "用于欢迎区和助手消息头像；为空时显示名称缩写。"
        })}
      </div>

      <div className="system-settings-subsection">
        <div className="resource-center-section-header">
          <div>
            <h4>行为说明</h4>
            <p>这些说明会引导新会话和用户侧默认行为文案。</p>
          </div>
        </div>

        <div className="resource-center-form-grid">
          <label className="field">
            <span className="field-label">欢迎摘要</span>
            <TextArea
              autoSize={{ minRows: 3, maxRows: 7 }}
              value={behavior.welcomeSummary}
              aria-invalid={Boolean(welcomeSummaryError)}
              disabled={disabled}
              onChange={(event) => onBehaviorChange({ welcomeSummary: event.target.value })}
            />
            {welcomeSummaryError ? <p className="field-error">{welcomeSummaryError}</p> : null}
          </label>

          <label className="field">
            <span className="field-label">使用摘要</span>
            <TextArea
              autoSize={{ minRows: 3, maxRows: 7 }}
              value={behavior.usageSummary}
              aria-invalid={Boolean(usageSummaryError)}
              disabled={disabled}
              onChange={(event) => onBehaviorChange({ usageSummary: event.target.value })}
            />
            {usageSummaryError ? <p className="field-error">{usageSummaryError}</p> : null}
          </label>

          <label className="field resource-center-form-span-2">
            <span className="field-label">Markdown 指南</span>
            <TextArea
              autoSize={{ minRows: 5, maxRows: 12 }}
              value={behavior.markdown}
              aria-invalid={Boolean(markdownError)}
              disabled={disabled}
              onChange={(event) => onBehaviorChange({ markdown: event.target.value })}
            />
            {markdownError ? <p className="field-error">{markdownError}</p> : null}
          </label>
        </div>
      </div>
    </section>
  );
}
