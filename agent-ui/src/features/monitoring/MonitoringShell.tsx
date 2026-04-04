import { useState } from "react";
import { Layout, Menu, Typography, Tag } from "antd";
import {
  DashboardOutlined,
  BarChartOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
  AlertOutlined,
  MoneyCollectOutlined
} from "@ant-design/icons";

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
  const panelMeta = PANELS.find((item) => item.id === panel) ?? PANELS[0];

  const menuItems = PANELS.map(item => ({
    key: item.id,
    icon: item.icon,
    label: item.label,
  }));

  return (
    <Layout className="admin-settings-layout">
      <Sider width={260} className="admin-settings-sider" theme="light">
        <div className="admin-settings-sider-header">
          <Typography.Title level={5} style={{ margin: 0 }}>
            审计监控工作台
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
            统一查看平台运行指标与策略
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[panel]}
          onClick={({ key }) => setPanel(key as MonitoringPanel)}
          items={menuItems}
          className="admin-settings-menu"
        />
      </Sider>
      <Content className="admin-settings-content">
        <div className="admin-settings-content-header">
          <div>
            <Typography.Title level={4} style={{ margin: 0, marginBottom: 4 }}>
              {panelMeta.label}
            </Typography.Title>
            <Typography.Text type="secondary">
              {panelMeta.description}
            </Typography.Text>
          </div>
          <Tag color="processing" style={{ borderRadius: 'var(--admin-radius-full)' }}>本地时区展示</Tag>
        </div>
        <div className="admin-settings-content-body">
          <CurrentPanel panel={panel} />
        </div>
      </Content>
    </Layout>
  );
}

export default MonitoringShell;
