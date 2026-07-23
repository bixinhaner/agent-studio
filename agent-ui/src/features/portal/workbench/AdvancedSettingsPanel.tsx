import type { ReactNode } from "react";
import { Drawer, Space, Typography } from "antd";
import { usePortalI18n } from "../i18n";

export function AdvancedSettingsPanel(props: {
  open: boolean;
  onClose(): void;
  modelLabel: string;
  reasoningLabel: string;
  children?: ReactNode;
}) {
  const { t } = usePortalI18n();
  return (
    <Drawer
      title={t("topbar.settings")}
      placement="left"
      width="min(420px, calc(100vw - 16px))"
      open={props.open}
      onClose={props.onClose}
      push={false}
      rootClassName="workbench-left-drawer"
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text strong>{t("settings.model")}</Typography.Text>
        <Typography.Paragraph>{props.modelLabel}</Typography.Paragraph>

        <Typography.Text strong>{t("settings.reasoning")}</Typography.Text>
        <Typography.Paragraph>{props.reasoningLabel}</Typography.Paragraph>

        {props.children}
      </Space>
    </Drawer>
  );
}
