import { Switch } from "antd";

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
          <Switch
            checked={value.showAdminOperationsAndConversationMenus}
            disabled={disabled}
            onChange={(checked) => onChange({ showAdminOperationsAndConversationMenus: checked })}
          />
          <span>
            <span className="field-label">显示运营分析和对话记录</span>
            <span className="field-help">关闭后，从管理后台导航和搜索中隐藏这两个入口；不会变更底层 API 权限。</span>
          </span>
        </label>

        <label className="field checkbox-field system-settings-toggle-row">
          <Switch
            checked={value.allowDangerFullAccess}
            disabled={disabled}
            onChange={(checked) => onChange({ allowDangerFullAccess: checked })}
          />
          <span>
            <span className="field-label">允许 danger-full-access</span>
            <span className="field-help">关闭后，任何运行配置都不能启用全访问沙箱。</span>
          </span>
        </label>

        <label className="field checkbox-field system-settings-toggle-row">
          <Switch
            checked={value.allowNetworkAccess}
            disabled={disabled}
            onChange={(checked) => onChange({ allowNetworkAccess: checked })}
          />
          <span>
            <span className="field-label">允许联网</span>
            <span className="field-help">关闭后，新会话和运行配置不能开启出网。</span>
          </span>
        </label>

        <label className="field checkbox-field system-settings-toggle-row">
          <Switch
            checked={value.allowLiveWebSearch}
            disabled={disabled}
            onChange={(checked) => onChange({ allowLiveWebSearch: checked })}
          />
          <span>
            <span className="field-label">允许实时网页搜索</span>
            <span className="field-help">关闭后，运行配置不能选择 live 搜索模式。</span>
          </span>
        </label>

        <label className="field checkbox-field system-settings-toggle-row">
          <Switch
            checked={value.allowCustomAdditionalDirectories}
            disabled={disabled}
            onChange={(checked) => onChange({ allowCustomAdditionalDirectories: checked })}
          />
          <span>
            <span className="field-label">允许自定义附加目录</span>
            <span className="field-help">关闭后，用户侧不可自由选择额外目录。</span>
          </span>
        </label>

        <label className="field checkbox-field system-settings-toggle-row">
          <Switch
            checked={value.allowFilesystemMutations}
            disabled={disabled}
            onChange={(checked) => onChange({ allowFilesystemMutations: checked })}
          />
          <span>
            <span className="field-label">允许文件系统写入</span>
            <span className="field-help">关闭后，新会话只能使用只读工作流。</span>
          </span>
        </label>
      </div>
    </section>
  );
}
