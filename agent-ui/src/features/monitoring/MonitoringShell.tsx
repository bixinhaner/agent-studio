import {
  AlertOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  FileTextOutlined,
  MenuOutlined,
  MoneyCollectOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { Button, Drawer, Layout, Menu, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import { AlertCenterView } from "./AlertCenterView";
import { CostProfilesView } from "./CostProfilesView";
import { MonitoringOverviewView } from "./MonitoringOverviewView";
import { QuotaRulesView } from "./QuotaRulesView";
import { ResourceAccessLogView } from "./ResourceAccessLogView";
import { UsageRankingsView } from "./UsageRankingsView";

const { Sider, Content } = Layout;

type MonitoringPanel =
  | "overview"
  | "rankings"
  | "resource-log"
  | "quota"
  | "alerts"
  | "pricing";

const PANELS: Array<{ id: MonitoringPanel; label: string; description: string; icon: React.ReactNode }> = [
  {
    id: "overview",
    label: "平台总览",
    description: "查看请求量、成本、告警与资源访问的汇总趋势。",
    icon: <DashboardOutlined />
  },
  {
    id: "rankings",
    label: "使用排行",
    description: "按用户、部门、模型、功能维度定位成本热点。",
    icon: <BarChartOutlined />
  },
  {
    id: "resource-log",
    label: "资源日志",
    description: "审计资源访问与使用事件，支持故障定位和追踪。",
    icon: <FileTextOutlined />
  },
  {
    id: "quota",
    label: "配额规则",
    description: "维护平台与部门级别配额策略和执行模式。",
    icon: <SafetyCertificateOutlined />
  },
  {
    id: "alerts",
    label: "告警中心",
    description: "处理开放告警并追踪通知投递结果。",
    icon: <AlertOutlined />
  },
  {
    id: "pricing",
    label: "模型定价",
    description: "维护模型单价与内部成本系数，统一成本核算口径。",
    icon: <MoneyCollectOutlined />
  }
];

function CurrentPanel(props: { panel: MonitoringPanel }) {
  if (props.panel === "overview") return <MonitoringOverviewView />;
  if (props.panel === "rankings") return <UsageRankingsView />;
  if (props.panel === "resource-log") return <ResourceAccessLogView />;
  if (props.panel === "quota") return <QuotaRulesView />;
  if (props.panel === "alerts") return <AlertCenterView />;
  return <CostProfilesView />;
}

export function MonitoringShell() {
  const [panel, setPanel] = useState<MonitoringPanel>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isNarrowScreen = useIsNarrowScreen(980);
  const panelMeta = PANELS.find((item) => item.id === panel) ?? PANELS[0];

  useEffect(() => {
    if (!isNarrowScreen) {
      setMobileNavOpen(false);
    }
  }, [isNarrowScreen]);

  const menuItems = PANELS.map((item) => ({
    key: item.id,
    icon: item.icon,
    label: item.label
  }));

  const navigationMenu = (
    <>
      <div
        className="admin-settings-sider-header"
        style={{ padding: "20px 16px", borderBottom: "1px solid var(--admin-color-border)" }}
      >
        <Typography.Title level={5} style={{ margin: 0 }}>
          审计监控工作台
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: "12px" }}>
          统一查看平台运行指标与策略
        </Typography.Text>
      </div>
      <Menu
        mode="inline"
        selectedKeys={[panel]}
        onClick={({ key }) => {
          setPanel(key as MonitoringPanel);
          setMobileNavOpen(false);
        }}
        items={menuItems}
        className="admin-settings-menu"
        style={{ borderRight: "none", padding: "12px 8px" }}
      />
    </>
  );

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            审计监控
          </Typography.Title>
          <Typography.Text type="secondary">追踪请求、成本、配额、告警和资源访问轨迹。</Typography.Text>
        </div>
        <Space wrap>
          <Tag color="processing" style={{ borderRadius: "var(--admin-radius-full)" }}>
            本地时区展示
          </Tag>
          {isNarrowScreen ? (
            <Button icon={<MenuOutlined />} onClick={() => setMobileNavOpen(true)} style={{ borderRadius: "var(--admin-radius-full)" }}>
              切换面板
            </Button>
          ) : null}
        </Space>
      </div>

      <Layout className="admin-settings-layout" style={{ marginTop: 4, background: "transparent" }}>
        {!isNarrowScreen ? (
          <Sider
            width={260}
            className="admin-settings-sider"
            theme="light"
            style={{
              background: "var(--admin-color-surface-solid)",
              borderRadius: "var(--admin-radius-lg)",
              border: "1px solid var(--admin-color-border)",
              overflow: "hidden"
            }}
          >
            {navigationMenu}
          </Sider>
        ) : null}

        <Content
          className="admin-settings-content"
          style={{
            background: "transparent",
            border: "none",
            boxShadow: "none",
            paddingLeft: isNarrowScreen ? 0 : 24,
            overflow: "visible"
          }}
        >
          <div
            style={{
              background: "var(--admin-color-surface-solid)",
              borderRadius: "var(--admin-radius-lg)",
              border: "1px solid var(--admin-color-border)",
              height: "100%",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column"
            }}
          >
            <div className="admin-settings-content-header" style={{ padding: "20px 24px", borderBottom: "1px solid var(--admin-color-border)" }}>
              <div>
                <Typography.Title level={4} style={{ margin: 0, marginBottom: 4 }}>
                  {panelMeta.label}
                </Typography.Title>
                <Typography.Text type="secondary">{panelMeta.description}</Typography.Text>
              </div>
              <Tag color="blue" style={{ borderRadius: "var(--admin-radius-full)" }}>
                {panelMeta.label}
              </Tag>
            </div>
            <div className="admin-settings-content-body" style={{ flex: 1, overflow: "auto", padding: 24 }}>
              <CurrentPanel panel={panel} />
            </div>
          </div>
        </Content>
      </Layout>

      <Drawer
        title="监控面板"
        placement="left"
        width={320}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        bodyStyle={{ padding: 0 }}
      >
        {navigationMenu}
      </Drawer>
    </div>
  );
}

export default MonitoringShell;
