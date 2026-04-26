import { useMemo, useState } from "react";
import { Button, Drawer, Space, Tooltip } from "antd";
import {
  Ellipsis,
  LayoutPanelLeft,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Shield
} from "lucide-react";

import { BrandMark } from "../../branding/BrandMark";
import { useBranding } from "../../branding/BrandingProvider";

export function PortalTopBar(props: {
  sessionRailCollapsed?: boolean;
  onToggleRail(): void;
  onOpenAdvancedSettings(): void;
  onToggleDrawer(): void;
  onOpenAdmin?: () => void;
  onOpenFeedback?: () => void;
  runtimeSummary?: string;
  drawerOpen?: boolean;
  showRuntimeSummary?: boolean;
  showAdvancedSettings?: boolean;
  showRightPanelToggle?: boolean;
  mobile?: boolean;
}) {
  const { branding } = useBranding();
  const isRightPanelOpen = props.drawerOpen;
  const showRuntimeSummary = props.showRuntimeSummary ?? true;
  const showAdvancedSettings = props.showAdvancedSettings ?? true;
  const showRightPanelToggle = props.showRightPanelToggle ?? true;
  const isMobile = props.mobile ?? false;
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const hasOverflowActions = Boolean(
    props.onOpenFeedback || props.onOpenAdmin || showAdvancedSettings || (showRuntimeSummary && props.runtimeSummary)
  );
  const mobileActionItems = useMemo(
    () => [
      props.onOpenFeedback
        ? {
            key: "feedback",
            label: "Send feedback",
            icon: <MessageSquareText size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              props.onOpenFeedback?.();
            }
          }
        : null,
      props.onOpenAdmin
        ? {
            key: "admin",
            label: "Open admin console",
            icon: <Shield size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              props.onOpenAdmin?.();
            }
          }
        : null,
      showAdvancedSettings
        ? {
            key: "settings",
            label: "Runtime settings",
            icon: <Settings size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              props.onOpenAdvancedSettings();
            }
          }
        : null
    ].filter(Boolean) as Array<{
      key: string;
      label: string;
      icon: JSX.Element;
      onClick(): void;
    }>,
    [props.onOpenAdmin, props.onOpenAdvancedSettings, props.onOpenFeedback, showAdvancedSettings]
  );

  return (
    <>
      <header className={isMobile ? "portal-topbar mobile" : "portal-topbar"} aria-label="Workbench top bar">
        <div className="portal-topbar-left">
          <Tooltip title={props.sessionRailCollapsed ? "Expand session rail" : "Collapse session rail"} placement="bottom">
            <Button
              type="text"
              className="portal-topbar-ghost-btn"
              icon={<LayoutPanelLeft size={18} />}
              onClick={props.onToggleRail}
              style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
              aria-label={props.sessionRailCollapsed ? "Expand session rail" : "Collapse session rail"}
            />
          </Tooltip>

          <div className="portal-topbar-brand" aria-label={branding.platformName} title={branding.platformName}>
            <BrandMark
              className="portal-topbar-brand-mark"
              imageClassName="portal-topbar-brand-image"
              name={branding.platformName}
              logoUrl={branding.logoUrl || branding.iconUrl}
            />
            {isMobile ? (
              showRuntimeSummary && props.runtimeSummary ? (
                <span className="portal-topbar-brand-copy">
                  <span className="portal-topbar-mobile-summary" title={props.runtimeSummary}>
                    {props.runtimeSummary}
                  </span>
                </span>
              ) : null
            ) : branding.headerSubtitle.trim() ? (
              <span className="portal-topbar-brand-copy">
                <span className="portal-topbar-brand-subtitle">{branding.headerSubtitle}</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="portal-topbar-right">
          {!isMobile && showRuntimeSummary && props.runtimeSummary ? (
            <span className="portal-topbar-runtime-chip" title={props.runtimeSummary}>
              {props.runtimeSummary}
            </span>
          ) : null}

          <Space size={8} className="portal-topbar-action-group">
            {!isMobile && props.onOpenFeedback ? (
              <Tooltip title="Send feedback" placement="bottom">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={<MessageSquareText size={18} />}
                  onClick={props.onOpenFeedback}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label="Send feedback"
                />
              </Tooltip>
            ) : null}
            {!isMobile && props.onOpenAdmin ? (
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
            {!isMobile && showAdvancedSettings ? (
              <Tooltip title="Runtime settings" placement="bottom">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={<Settings size={18} />}
                  onClick={props.onOpenAdvancedSettings}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label="Advanced settings"
                />
              </Tooltip>
            ) : null}
            {showRightPanelToggle ? (
              <Tooltip title={isRightPanelOpen ? "Close right panel" : "Open right panel"} placement="bottomLeft">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={isRightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
                  onClick={props.onToggleDrawer}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label="Toggle right panel"
                />
              </Tooltip>
            ) : null}
            {isMobile && hasOverflowActions ? (
              <Tooltip title="More actions" placement="bottomLeft">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={<Ellipsis size={18} />}
                  onClick={() => setMobileActionsOpen(true)}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label="More actions"
                />
              </Tooltip>
            ) : null}
          </Space>
        </div>
      </header>

      {isMobile ? (
        <Drawer
          placement="bottom"
          title="Workbench actions"
          open={mobileActionsOpen}
          onClose={() => setMobileActionsOpen(false)}
          height="auto"
          rootClassName="portal-topbar-mobile-actions-drawer"
          destroyOnHidden
        >
          <div className="portal-topbar-mobile-actions-sheet">
            {showRuntimeSummary && props.runtimeSummary ? (
              <section className="portal-topbar-mobile-actions-summary">
                <p className="portal-topbar-mobile-actions-eyebrow">Runtime</p>
                <p className="portal-topbar-mobile-actions-detail">{props.runtimeSummary}</p>
              </section>
            ) : null}
            <div className="portal-topbar-mobile-actions-list">
              {mobileActionItems.map((item) => (
                <Button
                  key={item.key}
                  type="default"
                  className="portal-topbar-mobile-action-btn"
                  icon={item.icon}
                  onClick={item.onClick}
                  block
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
