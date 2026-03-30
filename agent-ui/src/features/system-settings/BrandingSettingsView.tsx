import type { SystemSettingsBehavior, SystemSettingsBranding, SystemSettingsFieldErrors } from "./types";
import { getFieldError } from "./validation";

type BrandingSettingsViewProps = {
  value: SystemSettingsBranding;
  behavior: SystemSettingsBehavior;
  fieldErrors: SystemSettingsFieldErrors;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsBranding>): void;
  onBehaviorChange(patch: Partial<SystemSettingsBehavior>): void;
};

export function BrandingSettingsView({ value, behavior, fieldErrors, disabled, onChange, onBehaviorChange }: BrandingSettingsViewProps) {
  const platformNameError = getFieldError(fieldErrors, "branding.platformName");
  const headerSubtitleError = getFieldError(fieldErrors, "branding.headerSubtitle");
  const loginCopyError = getFieldError(fieldErrors, "branding.loginCopy");
  const logoUrlError = getFieldError(fieldErrors, "branding.logoUrl");
  const iconUrlError = getFieldError(fieldErrors, "branding.iconUrl");
  const welcomeSummaryError = getFieldError(fieldErrors, "behavior.welcomeSummary");
  const usageSummaryError = getFieldError(fieldErrors, "behavior.usageSummary");
  const markdownError = getFieldError(fieldErrors, "behavior.markdown");

  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>基本设置</h3>
          <p>维护品牌、登录页和行为说明，这些内容会在新会话中展示。</p>
        </div>
      </div>

      <div className="resource-center-form-grid">
        <label className="field">
          <span className="field-label">平台名称</span>
          <input
            className="field-input"
            value={value.platformName}
            aria-invalid={Boolean(platformNameError)}
            disabled={disabled}
            onChange={(event) => onChange({ platformName: event.target.value })}
          />
          {platformNameError ? <p className="field-error">{platformNameError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">页眉副标题</span>
          <input
            className="field-input"
            value={value.headerSubtitle}
            aria-invalid={Boolean(headerSubtitleError)}
            disabled={disabled}
            onChange={(event) => onChange({ headerSubtitle: event.target.value })}
          />
          {headerSubtitleError ? <p className="field-error">{headerSubtitleError}</p> : null}
        </label>

        <label className="field resource-center-form-span-2">
          <span className="field-label">登录页文案</span>
          <textarea
            className="field-input textarea"
            value={value.loginCopy}
            aria-invalid={Boolean(loginCopyError)}
            disabled={disabled}
            onChange={(event) => onChange({ loginCopy: event.target.value })}
          />
          {loginCopyError ? <p className="field-error">{loginCopyError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">Logo URL</span>
          <input
            className="field-input"
            value={value.logoUrl}
            aria-invalid={Boolean(logoUrlError)}
            disabled={disabled}
            onChange={(event) => onChange({ logoUrl: event.target.value })}
          />
          {logoUrlError ? <p className="field-error">{logoUrlError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">图标 URL</span>
          <input
            className="field-input"
            value={value.iconUrl}
            aria-invalid={Boolean(iconUrlError)}
            disabled={disabled}
            onChange={(event) => onChange({ iconUrl: event.target.value })}
          />
          {iconUrlError ? <p className="field-error">{iconUrlError}</p> : null}
        </label>
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
            <textarea
              className="field-input textarea"
              value={behavior.welcomeSummary}
              aria-invalid={Boolean(welcomeSummaryError)}
              disabled={disabled}
              onChange={(event) => onBehaviorChange({ welcomeSummary: event.target.value })}
            />
            {welcomeSummaryError ? <p className="field-error">{welcomeSummaryError}</p> : null}
          </label>

          <label className="field">
            <span className="field-label">使用摘要</span>
            <textarea
              className="field-input textarea"
              value={behavior.usageSummary}
              aria-invalid={Boolean(usageSummaryError)}
              disabled={disabled}
              onChange={(event) => onBehaviorChange({ usageSummary: event.target.value })}
            />
            {usageSummaryError ? <p className="field-error">{usageSummaryError}</p> : null}
          </label>

          <label className="field resource-center-form-span-2">
            <span className="field-label">Markdown 指南</span>
            <textarea
              className="field-input textarea"
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
