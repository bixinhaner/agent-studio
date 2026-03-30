import type { SystemSettingsBranding } from "./types";
import type { SystemSettingsBehavior } from "./types";

type BrandingSettingsViewProps = {
  value: SystemSettingsBranding;
  behavior: SystemSettingsBehavior;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsBranding>): void;
  onBehaviorChange(patch: Partial<SystemSettingsBehavior>): void;
};

export function BrandingSettingsView({ value, behavior, disabled, onChange, onBehaviorChange }: BrandingSettingsViewProps) {
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
          <input className="field-input" value={value.platformName} disabled={disabled} onChange={(event) => onChange({ platformName: event.target.value })} />
        </label>

        <label className="field">
          <span className="field-label">页眉副标题</span>
          <input className="field-input" value={value.headerSubtitle} disabled={disabled} onChange={(event) => onChange({ headerSubtitle: event.target.value })} />
        </label>

        <label className="field resource-center-form-span-2">
          <span className="field-label">登录页文案</span>
          <textarea className="field-input textarea" value={value.loginCopy} disabled={disabled} onChange={(event) => onChange({ loginCopy: event.target.value })} />
        </label>

        <label className="field">
          <span className="field-label">Logo URL</span>
          <input className="field-input" value={value.logoUrl} disabled={disabled} onChange={(event) => onChange({ logoUrl: event.target.value })} />
        </label>

        <label className="field">
          <span className="field-label">图标 URL</span>
          <input className="field-input" value={value.iconUrl} disabled={disabled} onChange={(event) => onChange({ iconUrl: event.target.value })} />
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
            <textarea className="field-input textarea" value={behavior.welcomeSummary} disabled={disabled} onChange={(event) => onBehaviorChange({ welcomeSummary: event.target.value })} />
          </label>

          <label className="field">
            <span className="field-label">使用摘要</span>
            <textarea className="field-input textarea" value={behavior.usageSummary} disabled={disabled} onChange={(event) => onBehaviorChange({ usageSummary: event.target.value })} />
          </label>

          <label className="field resource-center-form-span-2">
            <span className="field-label">Markdown 指南</span>
            <textarea className="field-input textarea" value={behavior.markdown} disabled={disabled} onChange={(event) => onBehaviorChange({ markdown: event.target.value })} />
          </label>
        </div>
      </div>
    </section>
  );
}
