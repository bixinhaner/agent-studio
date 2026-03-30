import type { SystemSettingsSafety } from "./types";

type SafetySettingsViewProps = {
  value: SystemSettingsSafety;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsSafety>): void;
};

export function SafetySettingsView({ value, disabled, onChange }: SafetySettingsViewProps) {
  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>安全策略</h3>
          <p>定义平台级硬限制，运行配置只能在这些边界内收窄。</p>
        </div>
      </div>

      <div className="system-settings-toggle-grid">
        <label className="field checkbox-field system-settings-toggle-row">
          <input type="checkbox" checked={value.allowDangerFullAccess} disabled={disabled} onChange={(event) => onChange({ allowDangerFullAccess: event.target.checked })} />
          <span>
            <span className="field-label">允许 danger-full-access</span>
            <span className="field-help">关闭后，任何运行配置都不能启用全访问沙箱。</span>
          </span>
        </label>

        <label className="field checkbox-field system-settings-toggle-row">
          <input type="checkbox" checked={value.allowNetworkAccess} disabled={disabled} onChange={(event) => onChange({ allowNetworkAccess: event.target.checked })} />
          <span>
            <span className="field-label">允许联网</span>
            <span className="field-help">关闭后，新会话和运行配置不能开启出网。</span>
          </span>
        </label>

        <label className="field checkbox-field system-settings-toggle-row">
          <input type="checkbox" checked={value.allowLiveWebSearch} disabled={disabled} onChange={(event) => onChange({ allowLiveWebSearch: event.target.checked })} />
          <span>
            <span className="field-label">允许实时网页搜索</span>
            <span className="field-help">关闭后，运行配置不能选择 live 搜索模式。</span>
          </span>
        </label>

        <label className="field checkbox-field system-settings-toggle-row">
          <input type="checkbox" checked={value.allowCustomAdditionalDirectories} disabled={disabled} onChange={(event) => onChange({ allowCustomAdditionalDirectories: event.target.checked })} />
          <span>
            <span className="field-label">允许自定义附加目录</span>
            <span className="field-help">关闭后，用户侧不可自由选择额外目录。</span>
          </span>
        </label>

        <label className="field checkbox-field system-settings-toggle-row">
          <input type="checkbox" checked={value.allowFilesystemMutations} disabled={disabled} onChange={(event) => onChange({ allowFilesystemMutations: event.target.checked })} />
          <span>
            <span className="field-label">允许文件系统写入</span>
            <span className="field-help">关闭后，新会话只能使用只读工作流。</span>
          </span>
        </label>
      </div>
    </section>
  );
}
