import { Alert, Input, Select } from "antd";

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
  const sessionWorkspaceRootError = getFieldError(fieldErrors, "platformDefaults.sessionWorkspaceRoot");

  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>运行时默认与兜底</h3>
          <p>管理平台级运行时来源与会话根目录；模型和推理强度仅作为未显式指定时的全局兜底。</p>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Agent Mode 绑定的 Run Profile 优先"
        description="用户实际会话如果已经由 Agent Mode / Run Profile 指定模型或推理强度，会优先使用智能体配置；这里的模型和推理强度只在请求未显式指定时接管。"
      />

      <div className="resource-center-form-grid">
        <label className="field">
          <span className="field-label">全局运行时来源</span>
          <span className="field-help">用于选择平台默认连接到哪类 Codex provider，不受 Run Profile 覆盖。</span>
          <Select
            value={value.provider}
            options={[
              { label: "管理台 OpenAI Codex 集成", value: "openai_codex" },
              { label: "服务器本地登录态", value: "local_auth" }
            ]}
            aria-invalid={Boolean(providerError)}
            disabled={disabled}
            onChange={(next) => onChange({ provider: next })}
          />
          {providerError ? <p className="field-error">{providerError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">兜底模型</span>
          <span className="field-help">仅在新会话未显式传入模型，且当前 Agent Mode / Run Profile 未覆盖模型时生效。</span>
          <Input
            value={value.model}
            aria-invalid={Boolean(modelError)}
            disabled={disabled}
            onChange={(event) => onChange({ model: event.target.value })}
          />
          {modelError ? <p className="field-error">{modelError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">兜底推理强度</span>
          <span className="field-help">仅在新会话未显式传入推理强度，且当前 Agent Mode / Run Profile 未覆盖时生效。</span>
          <Input
            value={value.reasoningEffort}
            aria-invalid={Boolean(reasoningEffortError)}
            disabled={disabled}
            onChange={(event) => onChange({ reasoningEffort: event.target.value })}
          />
          {reasoningEffortError ? <p className="field-error">{reasoningEffortError}</p> : null}
        </label>

        <label className="field">
          <span className="field-label">全局会话根目录</span>
          <span className="field-help">控制新建 workspace 的根目录。这是平台级路径设置，不由 Run Profile 覆盖。</span>
          <Input
            value={value.sessionWorkspaceRoot}
            aria-invalid={Boolean(sessionWorkspaceRootError)}
            disabled={disabled}
            onChange={(event) => onChange({ sessionWorkspaceRoot: event.target.value })}
          />
          {sessionWorkspaceRootError ? <p className="field-error">{sessionWorkspaceRootError}</p> : null}
        </label>
      </div>
    </section>
  );
}
