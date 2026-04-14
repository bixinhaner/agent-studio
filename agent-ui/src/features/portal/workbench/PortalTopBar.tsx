import { Button, Space, Tooltip } from "antd";
import { LayoutPanelLeft, Settings, PanelRightClose, PanelRightOpen, Shield } from "lucide-react";

import type { WorkbenchTab } from "./layout-state";

const WORKBENCH_TAB_LABEL: Record<WorkbenchTab, string> = {
  preview: "Preview",
  collaboration: "Collaboration"
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
    <header className="portal-topbar" aria-label="Workbench top bar">
      <div className="portal-topbar-left">
        <Tooltip title={props.sessionRailCollapsed ? "Expand session rail" : "Collapse session rail"} placement="bottom">
          <Button
            type="text"
            className="portal-topbar-ghost-btn"
            icon={<LayoutPanelLeft size={18} />}
            onClick={props.onToggleRail}
            style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label={props.sessionRailCollapsed ? "Expand session rail" : "Collapse session rail"}
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
            <Tooltip title="Open admin console" placement="bottom">
              <Button
                type="text"
                className="portal-topbar-ghost-btn"
                icon={<Shield size={18} />}
                onClick={props.onOpenAdmin}
                style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                aria-label="Open admin console"
              />
            </Tooltip>
          ) : null}
          <Tooltip title="Runtime settings" placement="bottom">
            <Button 
              type="text" 
              className="portal-topbar-ghost-btn" 
              icon={<Settings size={18} />} 
              onClick={props.onOpenAdvancedSettings}
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Advanced settings"
            />
          </Tooltip>
          <Tooltip title={isRightPanelOpen ? "Close right panel" : "Open right panel"} placement="bottomLeft">
            <Button 
              type="text" 
              className="portal-topbar-ghost-btn"
              icon={isRightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              onClick={props.onToggleDrawer}
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Toggle right panel"
            />
          </Tooltip>
        </Space>
      </div>
    </header>
  );
}
