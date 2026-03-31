import { Button, Space } from "antd";

import type { WorkbenchTab } from "./layout-state";

const WORKBENCH_TAB_LABEL: Record<WorkbenchTab, string> = {
  writing: "写作",
  collaboration: "协作"
};

export function PortalTopBar(props: {
  sessionRailCollapsed?: boolean;
  onToggleRail(): void;
  onOpenAdvancedSettings(): void;
  onOpenDrawer(): void;
  runtimeSummary?: string;
  drawerOpen?: boolean;
  activeDrawerTab?: WorkbenchTab;
}) {
  const drawerStateText = props.drawerOpen
    ? `当前：${WORKBENCH_TAB_LABEL[props.activeDrawerTab ?? "writing"]}`
    : "当前：未打开";

  return (
    <header className="portal-topbar" aria-label="工作台顶栏">
      <div className="portal-topbar-left">
        <div className="portal-topbar-brand" aria-label="Agent Studio">
          <span className="portal-topbar-brand-mark" aria-hidden="true">
            AS
          </span>
          <span className="portal-topbar-brand-title">Agent Studio</span>
        </div>
        <Space size={8}>
          <Button
            type="text"
            aria-label={props.sessionRailCollapsed !== false ? "展开会话栏" : "收起会话栏"}
            onClick={props.onToggleRail}
          >
            会话
          </Button>
          <Button aria-label="高级设置" onClick={props.onOpenAdvancedSettings}>
            高级设置
          </Button>
        </Space>
      </div>
      <div className="portal-topbar-right">
        {props.runtimeSummary ? (
          <span className="portal-topbar-runtime" title={props.runtimeSummary}>
            {props.runtimeSummary}
          </span>
        ) : null}
        <span className="portal-topbar-drawer-state" aria-live="polite">
          {drawerStateText}
        </span>
        <Button type="primary" aria-label="打开工作台抽屉" onClick={props.onOpenDrawer}>
          写作 / 协作
        </Button>
      </div>
    </header>
  );
}
