import type { ReactNode } from "react";
import { Drawer, Space, Typography } from "antd";

export function AdvancedSettingsPanel(props: {
  open: boolean;
  onClose(): void;
  modelLabel: string;
  reasoningLabel: string;
  children?: ReactNode;
  mobile?: boolean;
}) {
  const isMobile = props.mobile ?? false;
  return (
    <Drawer
      title="Runtime settings"
      placement={isMobile ? "bottom" : "left"}
      width={isMobile ? undefined : "min(420px, calc(100vw - 16px))"}
      height={isMobile ? "min(88vh, 760px)" : undefined}
      open={props.open}
      onClose={props.onClose}
      rootClassName="workbench-left-drawer"
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text strong>Model</Typography.Text>
        <Typography.Paragraph>{props.modelLabel}</Typography.Paragraph>

        <Typography.Text strong>Reasoning</Typography.Text>
        <Typography.Paragraph>{props.reasoningLabel}</Typography.Paragraph>

        {props.children}
      </Space>
    </Drawer>
  );
}
