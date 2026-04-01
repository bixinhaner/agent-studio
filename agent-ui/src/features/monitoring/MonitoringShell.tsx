import { useState } from "react";
import { Button, Card, Tag, Typography } from "antd";

import { AlertCenterView } from "./AlertCenterView";
import { CostProfilesView } from "./CostProfilesView";
import { MonitoringOverviewView } from "./MonitoringOverviewView";
import { QuotaRulesView } from "./QuotaRulesView";
import { ResourceAccessLogView } from "./ResourceAccessLogView";
import { UsageRankingsView } from "./UsageRankingsView";

type MonitoringPanel =
  | "overview"
  | "rankings"
  | "resource-log"
  | "quota"
  | "alerts"
  | "pricing";

const PANELS: Array<{ id: MonitoringPanel; label: string; description: string }> = [
  {
    id: "overview",
    label: "平台总览",
    description: "查看请求量、成本、告警与资源访问的汇总趋势。"
  },
  {
    id: "rankings",
    label: "使用排行",
    description: "按用户、部门、模型、功能维度定位成本热点。"
  },
  {
    id: "resource-log",
    label: "资源日志",
    description: "审计资源访问与使用事件，支持故障定位和追踪。"
  },
  {
    id: "quota",
    label: "配额规则",
    description: "维护平台与部门级别配额策略和执行模式。"
  },
  {
    id: "alerts",
    label: "告警中心",
    description: "处理开放告警并追踪通知投递结果。"
  },
  {
    id: "pricing",
    label: "模型定价",
    description: "维护模型单价与内部成本系数，统一成本核算口径。"
  }
];

function CurrentPanel(props: { panel: MonitoringPanel }) {
  if (props.panel === "overview") {
    return <MonitoringOverviewView />;
  }
  if (props.panel === "rankings") {
    return <UsageRankingsView />;
  }
  if (props.panel === "resource-log") {
    return <ResourceAccessLogView />;
  }
  if (props.panel === "quota") {
    return <QuotaRulesView />;
  }
  if (props.panel === "alerts") {
    return <AlertCenterView />;
  }
  return <CostProfilesView />;
}

export function MonitoringShell() {
  const [panel, setPanel] = useState<MonitoringPanel>("overview");
  const panelMeta = PANELS.find((item) => item.id === panel) ?? PANELS[0];

  return (
    <section className="monitoring-shell">
      <Card className="admin-card monitoring-shell-header antd-admin-card">
        <div className="monitoring-shell-heading">
          <div>
            <Typography.Title level={4} className="admin-card-heading">
              审计监控工作台
            </Typography.Title>
            <Typography.Paragraph>统一查看平台运行指标、策略配置与告警处理过程。</Typography.Paragraph>
          </div>
          <Tag color="processing">本地时区展示</Tag>
        </div>

        <div className="monitoring-shell-tabs" role="tablist" aria-label="监控分区">
          {PANELS.map((item) => {
            const active = item.id === panel;
            return (
              <Button
                key={item.id}
                type={active ? "primary" : "default"}
                role="tab"
                aria-selected={active}
                className={active ? "monitoring-shell-tab active" : "monitoring-shell-tab"}
                onClick={() => setPanel(item.id)}
              >
                {item.label}
              </Button>
            );
          })}
        </div>

        <div className="monitoring-shell-context" aria-live="polite">
          <Tag color="blue">当前模块：{panelMeta.label}</Tag>
          <span className="monitoring-subtle">{panelMeta.description}</span>
        </div>
      </Card>

      <CurrentPanel panel={panel} />
    </section>
  );
}

export default MonitoringShell;
