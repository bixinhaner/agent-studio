import type { ReactNode } from "react";
import { Drawer, Space, Typography } from "antd";

export function AdvancedSettingsPanel(props: {
  open: boolean;
  onClose(): void;
  modelLabel: string;
  reasoningLabel: string;
  children?: ReactNode;
}) {
  return (
    <Drawer
      title="运行配置"
      placement="left"
      width="min(420px, calc(100vw - 16px))"
      open={props.open}
      onClose={props.onClose}
      rootClassName="workbench-left-drawer"
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text strong>模型</Typography.Text>
        <Typography.Paragraph>{props.modelLabel}</Typography.Paragraph>

        <Typography.Text strong>思考深度</Typography.Text>
        <Typography.Paragraph>{props.reasoningLabel}</Typography.Paragraph>

        {props.children}
      </Space>
    </Drawer>
  );
}
