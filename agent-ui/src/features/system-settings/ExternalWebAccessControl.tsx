import { useEffect, useState } from "react";
import { Alert, Modal, Spin, Switch, Tag } from "antd";

import {
  fetchExternalWebAccessState,
  updateExternalWebAccessState,
  type ExternalWebAccessState
} from "./api";

function formatLocalDateTime(value: string | null) {
  if (!value) return "尚未操作";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "尚未操作" : parsed.toLocaleString();
}

export function ExternalWebAccessControl() {
  const [state, setState] = useState<ExternalWebAccessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetchExternalWebAccessState()
      .then((next) => {
        if (active) setState(next);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : "加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function requestUpdate(maintenanceEnabled: boolean) {
    Modal.confirm({
      title: maintenanceEnabled ? "开启外部 Web 维护模式？" : "恢复外部 Web 访问？",
      content: maintenanceEnabled
        ? "确认后立即阻止外部用户通过 Web 登录和使用 Portal；内部员工及非 Web 外部渠道不受影响。"
        : "确认后外部用户可立即恢复 Web 登录和 Portal 使用。",
      okText: maintenanceEnabled ? "确认开启" : "确认恢复",
      cancelText: "取消",
      okButtonProps: maintenanceEnabled ? { danger: true } : undefined,
      onOk: async () => {
        setUpdating(true);
        setError("");
        try {
          setState(await updateExternalWebAccessState(maintenanceEnabled));
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "更新失败");
          throw nextError;
        } finally {
          setUpdating(false);
        }
      }
    });
  }

  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>外部 Web 访问总闸</h3>
          <p>独立即时生效，不会发布或覆盖系统配置草稿。</p>
        </div>
        {state ? (
          <Tag color={state.maintenanceEnabled ? "error" : "success"}>
            {state.maintenanceEnabled ? "维护中" : "正常开放"}
          </Tag>
        ) : null}
      </div>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

      {loading ? (
        <Spin size="small" />
      ) : (
        <label className="field checkbox-field system-settings-toggle-row">
          <Switch
            aria-label="外部 Web 维护模式"
            checked={state?.maintenanceEnabled ?? false}
            disabled={!state || updating}
            loading={updating}
            onChange={requestUpdate}
          />
          <span>
            <span className="field-label">外部 Web 维护模式</span>
            <span className="field-help">
              开启后，外部登录、邀请、访问申请和已有外部 Portal 会话会立即停止，对外仅显示“系统维护中，请稍后再试。”；CREST、Zendesk、OpenAI-compatible API 等非 Web 渠道不受影响。
            </span>
            <span className="field-help">最近操作：{formatLocalDateTime(state?.updatedAt ?? null)}</span>
          </span>
        </label>
      )}
    </section>
  );
}
