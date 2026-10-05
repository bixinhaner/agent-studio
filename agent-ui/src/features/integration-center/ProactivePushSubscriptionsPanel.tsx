import { Alert, Button, Card, Space } from "antd";
import { BellRing } from "lucide-react";
import { useState } from "react";

import { PortalI18nProvider } from "../portal/i18n";
import { SubscriptionsDrawer } from "../portal/roadmap/SubscriptionsDrawer";
import "../portal/roadmap/roadmap.css";

/**
 * OMC proactive findings push to DingTalk. This lives with the Action
 * Connector because subscriptions only make sense for operations staff who
 * configure OMC; portal users never see these findings.
 */
export function ProactivePushSubscriptionsPanel() {
  const [open, setOpen] = useState(false);
  return (
    <Card size="small" title="主动发现推送" className="antd-admin-card">
      <Space direction="vertical" size={12} className="admin-full-width">
        <Alert
          type="info"
          showIcon
          className="admin-alert-inline"
          message="把 Action Connector（OMC）主动巡检产生的发现推送到钉钉。订阅覆盖所有 OMC 连接器，可按场景、来源和最低级别筛选；同一条发现对同一个人只推送一次。"
        />
        <div>
          <Button type="primary" icon={<BellRing size={15} />} onClick={() => setOpen(true)}>
            管理推送订阅
          </Button>
        </div>
      </Space>
      <PortalI18nProvider defaultLocale="zh-CN" languageSwitcherEnabled={false}>
        <SubscriptionsDrawer open={open} onClose={() => setOpen(false)} />
      </PortalI18nProvider>
    </Card>
  );
}
