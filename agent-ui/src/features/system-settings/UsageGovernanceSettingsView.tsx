import { Tabs, Typography } from "antd";

import { AlertCenterView } from "../monitoring/AlertCenterView";
import { CostProfilesView } from "../monitoring/CostProfilesView";
import { QuotaRulesView } from "../monitoring/QuotaRulesView";

export function UsageGovernanceSettingsView() {
  return (
    <section className="system-settings-usage-governance">
      <div className="resource-center-section-header">
        <div>
          <Typography.Title level={5}>用量治理</Typography.Title>
          <Typography.Paragraph>
            模型定价、配额阈值和告警处理会直接影响运行时，保存后即时生效，不进入系统配置草稿发布流。
          </Typography.Paragraph>
        </div>
      </div>

      <Tabs
        className="system-settings-governance-tabs"
        destroyInactiveTabPane={false}
        items={[
          {
            key: "pricing",
            label: "模型定价",
            children: <CostProfilesView />
          },
          {
            key: "quota",
            label: "配额规则",
            children: <QuotaRulesView />
          },
          {
            key: "alerts",
            label: "告警事件",
            children: <AlertCenterView />
          }
        ]}
      />
    </section>
  );
}

export default UsageGovernanceSettingsView;
