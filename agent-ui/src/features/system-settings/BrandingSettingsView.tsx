import { useState } from "react";
import { Button, Input, Upload } from "antd";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

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
const MAX_PORTAL_WELCOME_SUGGESTIONS = 8;

function fieldForAssetKind(
  kind: BrandingAssetKind
): keyof Pick<
  SystemSettingsBranding,
  "logoUrl" | "iconUrl" | "loginBackgroundUrl" | "portalWelcomeIllustrationUrl" | "assistantAvatarUrl"
> {
  if (kind === "logo") return "logoUrl";
  if (kind === "icon") return "iconUrl";
  if (kind === "login-background") return "loginBackgroundUrl";
  if (kind === "portal-welcome-illustration") return "portalWelcomeIllustrationUrl";
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
  const internalLoginCopyError = getFieldError(fieldErrors, "branding.internalLoginCopy");
  const externalLoginCopyError = getFieldError(fieldErrors, "branding.externalLoginCopy");
  const logoUrlError = getFieldError(fieldErrors, "branding.logoUrl");
  const iconUrlError = getFieldError(fieldErrors, "branding.iconUrl");
  const loginBackgroundUrlError = getFieldError(fieldErrors, "branding.loginBackgroundUrl");
  const portalWelcomeIllustrationUrlError = getFieldError(fieldErrors, "branding.portalWelcomeIllustrationUrl");
  const assistantNameError = getFieldError(fieldErrors, "branding.assistantName");
  const assistantAvatarUrlError = getFieldError(fieldErrors, "branding.assistantAvatarUrl");
  const markdownError = getFieldError(fieldErrors, "behavior.markdown");
  const portalWelcomeMessageDesktopError = getFieldError(fieldErrors, "behavior.portalWelcomeMessageDesktop");
  const portalWelcomeMessageMobileError = getFieldError(fieldErrors, "behavior.portalWelcomeMessageMobile");
  const portalWelcomeSuggestionsError = getFieldError(fieldErrors, "behavior.portalWelcomeSuggestions");

  const welcomeSuggestions = behavior.portalWelcomeSuggestions;

  function welcomeSuggestionFieldError(index: number, field: "label" | "prompt") {
    return getFieldError(fieldErrors, `behavior.portalWelcomeSuggestions.${index}.${field}`);
  }

  function updateWelcomeSuggestion(index: number, patch: Partial<SystemSettingsBehavior["portalWelcomeSuggestions"][number]>) {
    onBehaviorChange({
      portalWelcomeSuggestions: welcomeSuggestions.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    });
  }

  function moveWelcomeSuggestion(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= welcomeSuggestions.length) return;
    const next = welcomeSuggestions.map((item) => ({ ...item }));
    const [current] = next.splice(index, 1);
    next.splice(nextIndex, 0, current);
    onBehaviorChange({ portalWelcomeSuggestions: next });
  }

  function removeWelcomeSuggestion(index: number) {
    onBehaviorChange({
      portalWelcomeSuggestions: welcomeSuggestions.filter((_, itemIndex) => itemIndex !== index)
    });
  }

  function addWelcomeSuggestion() {
    if (welcomeSuggestions.length >= MAX_PORTAL_WELCOME_SUGGESTIONS) return;
    onBehaviorChange({
      portalWelcomeSuggestions: [
        ...welcomeSuggestions,
        {
          label: "",
          prompt: ""
        }
      ]
    });
  }

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

  function imagePreviewCard(input: {
    label: string;
    url: string;
    emptyText: string;
    imageClassName: string;
  }) {
    const src = input.url.trim();
    return (
      <article className="branding-preview-card">
        <span className="branding-preview-label">{input.label}</span>
        <div className="branding-preview-media">
          {src ? (
            <img className={input.imageClassName} src={src} alt="" />
          ) : (
            <span className="branding-preview-media-empty">{input.emptyText}</span>
          )}
        </div>
      </article>
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
        {imagePreviewCard({
          label: "登录背景图",
          url: value.loginBackgroundUrl,
          emptyText: "未设置独立背景图",
          imageClassName: "branding-preview-background-image"
        })}
        {imagePreviewCard({
          label: "工作台欢迎图",
          url: value.portalWelcomeIllustrationUrl,
          emptyText: "未设置工作台欢迎图",
          imageClassName: "branding-preview-illustration-image"
        })}
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
          <span className="field-label">内部登录文案</span>
          <TextArea
            autoSize={{ minRows: 3, maxRows: 7 }}
            value={value.internalLoginCopy}
            aria-invalid={Boolean(internalLoginCopyError)}
            disabled={disabled}
            onChange={(event) => onChange({ internalLoginCopy: event.target.value })}
          />
          {internalLoginCopyError ? <p className="field-error">{internalLoginCopyError}</p> : null}
        </label>

        <label className="field resource-center-form-span-2">
          <span className="field-label">外部登录文案</span>
          <TextArea
            autoSize={{ minRows: 3, maxRows: 7 }}
            value={value.externalLoginCopy}
            aria-invalid={Boolean(externalLoginCopyError)}
            disabled={disabled}
            onChange={(event) => onChange({ externalLoginCopy: event.target.value })}
          />
          {externalLoginCopyError ? <p className="field-error">{externalLoginCopyError}</p> : null}
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

        {assetField({
          label: "登录背景图",
          value: value.loginBackgroundUrl,
          error: loginBackgroundUrlError,
          kind: "login-background",
          placeholder: "https://... 或 /public-api/...",
          help: "用于登录页背景主视觉；建议上传横向插画或宽幅图片。"
        })}

        {assetField({
          label: "工作台欢迎图",
          value: value.portalWelcomeIllustrationUrl,
          error: portalWelcomeIllustrationUrlError,
          kind: "portal-welcome-illustration",
          placeholder: "https://... 或 /public-api/...",
          help: "用于工作台空状态欢迎区中间主图；建议上传透明背景 PNG 或浅色插画。"
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

        <div className="system-settings-subsection system-settings-subsection-cardless">
          <div className="resource-center-section-header">
            <div>
              <h4>欢迎区文案</h4>
              <p>用于新会话空白页中央的欢迎语和底部快捷建议。可使用 <code>{"{{assistantName}}"}</code> 和 <code>{"{{platformName}}"}</code> 自动带入名称。</p>
            </div>
          </div>

          <div className="resource-center-form-grid">
            <label className="field resource-center-form-span-2">
              <span className="field-label">桌面端欢迎文案</span>
              <TextArea
                autoSize={{ minRows: 3, maxRows: 6 }}
                value={behavior.portalWelcomeMessageDesktop}
                aria-invalid={Boolean(portalWelcomeMessageDesktopError)}
                disabled={disabled}
                onChange={(event) => onBehaviorChange({ portalWelcomeMessageDesktop: event.target.value })}
              />
              <span className="field-help">建议控制在一行到两行内，避免欢迎区显得过重。</span>
              {portalWelcomeMessageDesktopError ? <p className="field-error">{portalWelcomeMessageDesktopError}</p> : null}
            </label>

            <label className="field resource-center-form-span-2">
              <span className="field-label">移动端欢迎文案</span>
              <TextArea
                autoSize={{ minRows: 2, maxRows: 5 }}
                value={behavior.portalWelcomeMessageMobile}
                aria-invalid={Boolean(portalWelcomeMessageMobileError)}
                disabled={disabled}
                onChange={(event) => onBehaviorChange({ portalWelcomeMessageMobile: event.target.value })}
              />
              <span className="field-help">移动端建议更短，避免头像下方文案过宽。</span>
              {portalWelcomeMessageMobileError ? <p className="field-error">{portalWelcomeMessageMobileError}</p> : null}
            </label>
          </div>

          <div className="branding-suggestion-editor">
            <div className="branding-suggestion-editor-header">
              <div>
                <h5>快捷建议</h5>
                <p>配置欢迎区底部按钮文案，以及用户点击后自动带入输入框的问题模板。</p>
              </div>
              <Button
                type="default"
                icon={<Plus size={16} />}
                disabled={disabled || welcomeSuggestions.length >= MAX_PORTAL_WELCOME_SUGGESTIONS}
                onClick={addWelcomeSuggestion}
              >
                新增建议
              </Button>
            </div>

            {portalWelcomeSuggestionsError ? <p className="field-error">{portalWelcomeSuggestionsError}</p> : null}

            {welcomeSuggestions.length ? (
              <div className="branding-suggestion-list">
                {welcomeSuggestions.map((suggestion, index) => (
                  <article key={`portal-welcome-suggestion-${index}`} className="branding-suggestion-card">
                    <div className="branding-suggestion-card-header">
                      <div>
                        <span className="branding-suggestion-index">建议 {index + 1}</span>
                        <strong>{suggestion.label || "未命名建议"}</strong>
                      </div>
                      <div className="branding-suggestion-actions">
                        <Button
                          type="text"
                          className="branding-suggestion-action-btn"
                          icon={<ArrowUp size={16} />}
                          aria-label={`上移建议 ${index + 1}`}
                          disabled={disabled || index === 0}
                          onClick={() => moveWelcomeSuggestion(index, -1)}
                        />
                        <Button
                          type="text"
                          className="branding-suggestion-action-btn"
                          icon={<ArrowDown size={16} />}
                          aria-label={`下移建议 ${index + 1}`}
                          disabled={disabled || index === welcomeSuggestions.length - 1}
                          onClick={() => moveWelcomeSuggestion(index, 1)}
                        />
                        <Button
                          type="text"
                          danger
                          className="branding-suggestion-action-btn"
                          icon={<Trash2 size={16} />}
                          aria-label={`删除建议 ${index + 1}`}
                          disabled={disabled}
                          onClick={() => removeWelcomeSuggestion(index)}
                        />
                      </div>
                    </div>

                    <div className="resource-center-form-grid">
                      <label className="field">
                        <span className="field-label">按钮文案</span>
                        <Input
                          value={suggestion.label}
                          aria-invalid={Boolean(welcomeSuggestionFieldError(index, "label"))}
                          disabled={disabled}
                          placeholder="例如：Review deployment plan"
                          onChange={(event) => updateWelcomeSuggestion(index, { label: event.target.value })}
                        />
                        {welcomeSuggestionFieldError(index, "label") ? (
                          <p className="field-error">{welcomeSuggestionFieldError(index, "label")}</p>
                        ) : null}
                      </label>

                      <label className="field resource-center-form-span-2">
                        <span className="field-label">点击后带入的问题模板</span>
                        <TextArea
                          autoSize={{ minRows: 3, maxRows: 7 }}
                          value={suggestion.prompt}
                          aria-invalid={Boolean(welcomeSuggestionFieldError(index, "prompt"))}
                          disabled={disabled}
                          placeholder="例如：Review this deployment plan and point out risks, mismatches, and the recommended next steps."
                          onChange={(event) => updateWelcomeSuggestion(index, { prompt: event.target.value })}
                        />
                        <span className="field-help">用户点击建议后，这段内容会被直接带入输入框，建议写成完整、可直接发送的问题。</span>
                        {welcomeSuggestionFieldError(index, "prompt") ? (
                          <p className="field-error">{welcomeSuggestionFieldError(index, "prompt")}</p>
                        ) : null}
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="branding-suggestion-empty">
                <strong>当前未配置快捷建议</strong>
                <span>欢迎区底部将不显示建议按钮。你可以按业务场景添加常用提问入口。</span>
              </div>
            )}
          </div>
        </div>

        <div className="resource-center-form-grid">
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
