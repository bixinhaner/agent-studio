import type { ReactNode } from "react";
import { Drawer, Select, Space, Typography } from "antd";

export function AdvancedSettingsPanel(props: {
  open: boolean;
  onClose(): void;
  modelLabel: string;
  reasoningLabel: string;
  workspaceValue: string;
  workspaceOptions: Array<{ id: string; label: string; isDefault?: boolean }>;
  onWorkspaceChange(value: string): void;
  children?: ReactNode;
}) {
  return (
    <Drawer title="运行配置" placement="left" width={420} open={props.open} onClose={props.onClose}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text strong>模型</Typography.Text>
        <Typography.Paragraph>{props.modelLabel}</Typography.Paragraph>

        <Typography.Text strong>思考深度</Typography.Text>
        <Typography.Paragraph>{props.reasoningLabel}</Typography.Paragraph>

        <label htmlFor="advanced-workspace-select">
          <Typography.Text strong>工作目录</Typography.Text>
        </label>
        <Select
          id="advanced-workspace-select"
          value={props.workspaceValue}
          options={props.workspaceOptions.map((item) => ({ value: item.id, label: item.label }))}
          onChange={props.onWorkspaceChange}
        />

        {props.children}
      </Space>
    </Drawer>
  );
}
