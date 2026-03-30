import type { SystemSettingsRetention, SystemSettingsUploads } from "./types";

type RetentionUploadViewProps = {
  retention: SystemSettingsRetention;
  uploads: SystemSettingsUploads;
  disabled?: boolean;
  onRetentionChange(patch: Partial<SystemSettingsRetention>): void;
  onUploadsChange(patch: Partial<SystemSettingsUploads>): void;
};

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function RetentionUploadView({ retention, uploads, disabled, onRetentionChange, onUploadsChange }: RetentionUploadViewProps) {
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
          <input className="field-input" type="number" value={retention.sessionDays} disabled={disabled} onChange={(event) => onRetentionChange({ sessionDays: toNumber(event.target.value) })} />
        </label>

        <label className="field">
          <span className="field-label">附件保留天数</span>
          <input className="field-input" type="number" value={retention.attachmentDays} disabled={disabled} onChange={(event) => onRetentionChange({ attachmentDays: toNumber(event.target.value) })} />
        </label>

        <label className="field">
          <span className="field-label">告警保留天数</span>
          <input className="field-input" type="number" value={retention.alertDays} disabled={disabled} onChange={(event) => onRetentionChange({ alertDays: toNumber(event.target.value) })} />
        </label>

        <label className="field">
          <span className="field-label">单文件上限（字节）</span>
          <input className="field-input" type="number" value={uploads.maxSingleFileBytes} disabled={disabled} onChange={(event) => onUploadsChange({ maxSingleFileBytes: toNumber(event.target.value) })} />
        </label>

        <label className="field">
          <span className="field-label">单次总上传上限（字节）</span>
          <input className="field-input" type="number" value={uploads.maxTotalUploadBytes} disabled={disabled} onChange={(event) => onUploadsChange({ maxTotalUploadBytes: toNumber(event.target.value) })} />
        </label>
      </div>
    </section>
  );
}
