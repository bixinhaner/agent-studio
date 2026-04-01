import { Input } from "antd";

import type { SystemSettingsFieldErrors, SystemSettingsPlatformDefaults } from "./types";
import { getFieldError } from "./validation";

type ModelDefaultsViewProps = {
  value: SystemSettingsPlatformDefaults;
  fieldErrors: SystemSettingsFieldErrors;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsPlatformDefaults>): void;
};

export function ModelDefaultsView({ value, fieldErrors, disabled, onChange }: ModelDefaultsViewProps) {
  const providerError = getFieldError(fieldErrors, "platformDefaults.provider");
  const modelError = getFieldError(fieldErrors, "platformDefaults.model");
  const reasoningEffortError = getFieldError(fieldErrors, "platformDefaults.reasoningEffort");

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
          <Input
            value={value.provider}
            aria-invalid={Boolean(providerError)}
            disabled={disabled}
            onChange={(event) => onChange({ provider: event.target.value })}
          />
          {providerError ? <p className="field-error">{providerError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">默认模型</span>
          <Input
            value={value.model}
            aria-invalid={Boolean(modelError)}
            disabled={disabled}
            onChange={(event) => onChange({ model: event.target.value })}
          />
          {modelError ? <p className="field-error">{modelError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">默认推理强度</span>
          <Input
            value={value.reasoningEffort}
            aria-invalid={Boolean(reasoningEffortError)}
            disabled={disabled}
            onChange={(event) => onChange({ reasoningEffort: event.target.value })}
          />
          {reasoningEffortError ? <p className="field-error">{reasoningEffortError}</p> : null}
        </label>
      </div>
    </section>
  );
}
