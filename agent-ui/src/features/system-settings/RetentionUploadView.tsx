import type { SystemSettingsFieldErrors, SystemSettingsRetention, SystemSettingsUploads } from "./types";
import { getFieldError } from "./validation";

type RetentionUploadViewProps = {
  retention: SystemSettingsRetention;
  uploads: SystemSettingsUploads;
  fieldErrors: SystemSettingsFieldErrors;
  disabled?: boolean;
  onRetentionChange(patch: Partial<SystemSettingsRetention>): void;
  onUploadsChange(patch: Partial<SystemSettingsUploads>): void;
};

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function RetentionUploadView({ retention, uploads, fieldErrors, disabled, onRetentionChange, onUploadsChange }: RetentionUploadViewProps) {
  const sessionDaysError = getFieldError(fieldErrors, "retention.sessionDays");
  const attachmentDaysError = getFieldError(fieldErrors, "retention.attachmentDays");
  const alertDaysError = getFieldError(fieldErrors, "retention.alertDays");
  const maxSingleFileBytesError = getFieldError(fieldErrors, "uploads.maxSingleFileBytes");
  const maxTotalUploadBytesError = getFieldError(fieldErrors, "uploads.maxTotalUploadBytes");

  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>保留与上传</h3>
          <p>设置会话、附件和告警保留时间，以及上传大小上限。</p>
        </div>
      </div>

      <div className="resource-center-form-grid">
        <label className="field">
          <span className="field-label">会话保留天数</span>
          <input
            className="field-input"
            type="number"
            value={retention.sessionDays}
            aria-invalid={Boolean(sessionDaysError)}
            disabled={disabled}
            onChange={(event) => onRetentionChange({ sessionDays: toNumber(event.target.value) })}
          />
          {sessionDaysError ? <p className="field-error">{sessionDaysError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">附件保留天数</span>
          <input
            className="field-input"
            type="number"
            value={retention.attachmentDays}
            aria-invalid={Boolean(attachmentDaysError)}
            disabled={disabled}
            onChange={(event) => onRetentionChange({ attachmentDays: toNumber(event.target.value) })}
          />
          {attachmentDaysError ? <p className="field-error">{attachmentDaysError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">告警保留天数</span>
          <input
            className="field-input"
            type="number"
            value={retention.alertDays}
            aria-invalid={Boolean(alertDaysError)}
            disabled={disabled}
            onChange={(event) => onRetentionChange({ alertDays: toNumber(event.target.value) })}
          />
          {alertDaysError ? <p className="field-error">{alertDaysError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">单文件上限（字节）</span>
          <input
            className="field-input"
            type="number"
            value={uploads.maxSingleFileBytes}
            aria-invalid={Boolean(maxSingleFileBytesError)}
            disabled={disabled}
            onChange={(event) => onUploadsChange({ maxSingleFileBytes: toNumber(event.target.value) })}
          />
          {maxSingleFileBytesError ? <p className="field-error">{maxSingleFileBytesError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">单次总上传上限（字节）</span>
          <input
            className="field-input"
            type="number"
            value={uploads.maxTotalUploadBytes}
            aria-invalid={Boolean(maxTotalUploadBytesError)}
            disabled={disabled}
            onChange={(event) => onUploadsChange({ maxTotalUploadBytes: toNumber(event.target.value) })}
          />
          {maxTotalUploadBytesError ? <p className="field-error">{maxTotalUploadBytesError}</p> : null}
        </label>
      </div>
    </section>
  );
}
