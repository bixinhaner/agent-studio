import { Button, Space, Tooltip } from "antd";
import { LayoutPanelLeft, Settings, PanelRightClose, PanelRightOpen, Shield } from "lucide-react";

import type { WorkbenchTab } from "./layout-state";

const WORKBENCH_TAB_LABEL: Record<WorkbenchTab, string> = {
  preview: "预览",
  collaboration: "协作"
};

export function PortalTopBar(props: {
  sessionRailCollapsed?: boolean;
  onToggleRail(): void;
  onOpenAdvancedSettings(): void;
  onToggleDrawer(): void;
  onOpenAdmin?: () => void;
  runtimeSummary?: string;
  drawerOpen?: boolean;
  activeDrawerTab?: WorkbenchTab;
}) {
  const isRightPanelOpen = props.drawerOpen;

  return (
    <header className="portal-topbar" aria-label="工作台顶栏">
      <div className="portal-topbar-left">
        <Tooltip title={props.sessionRailCollapsed ? "展开会话栏" : "收起会话栏"} placement="bottom">
          <Button
            type="text"
            className="portal-topbar-ghost-btn"
            icon={<LayoutPanelLeft size={18} />}
            onClick={props.onToggleRail}
            style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label={props.sessionRailCollapsed ? "展开会话栏" : "收起会话栏"}
          />
        </Tooltip>

        <div className="portal-topbar-brand" aria-label="Agent Studio">
          <span className="portal-topbar-brand-mark" aria-hidden="true">
            AS
          </span>
          <span className="portal-topbar-brand-copy">
            <span className="portal-topbar-brand-title">Agent Studio</span>
            <span className="portal-topbar-brand-subtitle">Workspace</span>
          </span>
        </div>
      </div>
      
      <div className="portal-topbar-right">
        {props.runtimeSummary ? (
          <span className="portal-topbar-runtime-chip" title={props.runtimeSummary}>
            {props.runtimeSummary}
          </span>
        ) : null}

        <Space size={8} className="portal-topbar-action-group">
          {props.onOpenAdmin ? (
            <Tooltip title="进入管理台" placement="bottom">
              <Button
                type="text"
                className="portal-topbar-ghost-btn"
                icon={<Shield size={18} />}
                onClick={props.onOpenAdmin}
                style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                aria-label="进入管理台"
              />
            </Tooltip>
          ) : null}
          <Tooltip title="运行参数" placement="bottom">
            <Button 
              type="text" 
              className="portal-topbar-ghost-btn" 
              icon={<Settings size={18} />} 
              onClick={props.onOpenAdvancedSettings}
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="高级设置"
            />
          </Tooltip>
          <Tooltip title={isRightPanelOpen ? "关闭工作台" : "打开工作台"} placement="bottomLeft">
            <Button 
              type="text" 
              className="portal-topbar-ghost-btn"
              icon={isRightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              onClick={props.onToggleDrawer}
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="打开/关闭工作台"
            />
          </Tooltip>
        </Space>
      </div>
    </header>
  );
}
