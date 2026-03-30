import type { SystemSettingsFieldErrors, SystemSettingsOrganizationDefaults } from "./types";
import { getFieldError } from "./validation";

type OrganizationDefaultsViewProps = {
  value: SystemSettingsOrganizationDefaults;
  fieldErrors: SystemSettingsFieldErrors;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsOrganizationDefaults>): void;
};

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function OrganizationDefaultsView({ value, fieldErrors, disabled, onChange }: OrganizationDefaultsViewProps) {
  const orgSyncIntervalMinutesError = getFieldError(fieldErrors, "organizationDefaults.orgSyncIntervalMinutes");

  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>组织默认值</h3>
          <p>控制组织同步的默认调度间隔。</p>
        </div>
      </div>

      <div className="resource-center-form-grid">
        <label className="field">
          <span className="field-label">组织同步间隔（分钟）</span>
          <input
            className="field-input"
            type="number"
            value={value.orgSyncIntervalMinutes}
            aria-invalid={Boolean(orgSyncIntervalMinutesError)}
            disabled={disabled}
            onChange={(event) => onChange({ orgSyncIntervalMinutes: toNumber(event.target.value) })}
          />
          {orgSyncIntervalMinutesError ? <p className="field-error">{orgSyncIntervalMinutesError}</p> : null}
        </label>
      </div>
    </section>
  );
}
