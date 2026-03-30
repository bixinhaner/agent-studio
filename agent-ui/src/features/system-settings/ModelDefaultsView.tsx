import type { SystemSettingsPlatformDefaults } from "./types";

type ModelDefaultsViewProps = {
  value: SystemSettingsPlatformDefaults;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsPlatformDefaults>): void;
};

export function ModelDefaultsView({ value, disabled, onChange }: ModelDefaultsViewProps) {
  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>模型默认值</h3>
          <p>设置新会话默认采用的提供方、模型和推理强度。</p>
        </div>
      </div>

      <div className="resource-center-form-grid">
        <label className="field">
          <span className="field-label">默认提供方</span>
          <input className="field-input" value={value.provider} disabled={disabled} onChange={(event) => onChange({ provider: event.target.value })} />
        </label>

        <label className="field">
          <span className="field-label">默认模型</span>
          <input className="field-input" value={value.model} disabled={disabled} onChange={(event) => onChange({ model: event.target.value })} />
        </label>

        <label className="field">
          <span className="field-label">默认推理强度</span>
          <input className="field-input" value={value.reasoningEffort} disabled={disabled} onChange={(event) => onChange({ reasoningEffort: event.target.value })} />
        </label>
      </div>
    </section>
  );
}
