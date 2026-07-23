import { useMemo, useState } from "react";
import { Button, Drawer, Space, Tooltip } from "antd";
import {
  Ellipsis,
  CreditCard,
  Globe2,
  LayoutPanelLeft,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Shield
} from "lucide-react";

import { BrandMark } from "../../branding/BrandMark";
import { useBranding } from "../../branding/BrandingProvider";
import { usePortalI18n } from "../i18n";

export function PortalTopBar(props: {
  sessionRailCollapsed?: boolean;
  onToggleRail(): void;
  onOpenAdvancedSettings(): void;
  onToggleDrawer(): void;
  onOpenAdmin?: () => void;
  onOpenFeedback?: () => void;
  onOpenBilling?: () => void;
  runtimeSummary?: string;
  drawerOpen?: boolean;
  showRuntimeSummary?: boolean;
  showAdvancedSettings?: boolean;
  showRightPanelToggle?: boolean;
  mobile?: boolean;
}) {
  const { branding } = useBranding();
  const { t, toggleLocale } = usePortalI18n();
  const isRightPanelOpen = props.drawerOpen;
  const showRuntimeSummary = props.showRuntimeSummary ?? true;
  const showAdvancedSettings = props.showAdvancedSettings ?? true;
  const showRightPanelToggle = props.showRightPanelToggle ?? true;
  const isMobile = props.mobile ?? false;
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const hasOverflowActions = true;
  const mobileActionItems = useMemo(
    () => [
      props.onOpenFeedback
        ? {
            key: "feedback",
            label: t("topbar.feedback"),
            icon: <MessageSquareText size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              props.onOpenFeedback?.();
            }
          }
        : null,
      props.onOpenBilling
        ? {
            key: "billing",
            label: t("topbar.billing"),
            icon: <CreditCard size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              props.onOpenBilling?.();
            }
          }
        : null,
      props.onOpenAdmin
        ? {
            key: "admin",
            label: t("topbar.admin"),
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
            label: t("topbar.settings"),
            icon: <Settings size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              props.onOpenAdvancedSettings();
            }
          }
        : null,
      {
        key: "language",
        label: t("language.switchTo"),
        icon: <Globe2 size={18} />,
        onClick: () => {
          setMobileActionsOpen(false);
          toggleLocale();
        }
      }
    ].filter(Boolean) as Array<{
      key: string;
      label: string;
      icon: JSX.Element;
      onClick(): void;
    }>,
    [props.onOpenAdmin, props.onOpenAdvancedSettings, props.onOpenBilling, props.onOpenFeedback, showAdvancedSettings, t, toggleLocale]
  );

  return (
    <>
      <header className={isMobile ? "portal-topbar mobile" : "portal-topbar"} aria-label={t("topbar.label")}>
        <div className="portal-topbar-left">
          <Tooltip title={props.sessionRailCollapsed ? t("topbar.expandSessions") : t("topbar.collapseSessions")} placement="bottom">
            <Button
              type="text"
              className="portal-topbar-ghost-btn"
              icon={<LayoutPanelLeft size={18} />}
              onClick={props.onToggleRail}
              style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
              aria-label={props.sessionRailCollapsed ? t("topbar.expandSessions") : t("topbar.collapseSessions")}
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
              <Tooltip title={t("topbar.feedback")} placement="bottom">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={<MessageSquareText size={18} />}
                  onClick={props.onOpenFeedback}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label={t("topbar.feedback")}
                />
              </Tooltip>
            ) : null}
            {!isMobile && props.onOpenBilling ? (
              <Tooltip title={t("topbar.billing")} placement="bottom">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={<CreditCard size={18} />}
                  onClick={props.onOpenBilling}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label={t("topbar.billingAria")}
                />
              </Tooltip>
            ) : null}
            {!isMobile && props.onOpenAdmin ? (
              <Tooltip title={t("topbar.admin")} placement="bottom">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={<Shield size={18} />}
                  onClick={props.onOpenAdmin}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label={t("topbar.admin")}
                />
              </Tooltip>
            ) : null}
            {!isMobile && showAdvancedSettings ? (
              <Tooltip title={t("topbar.settings")} placement="bottom">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={<Settings size={18} />}
                  onClick={props.onOpenAdvancedSettings}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label={t("topbar.advancedSettings")}
                />
              </Tooltip>
            ) : null}
            {!isMobile ? (
              <Tooltip title={t("language.switchTo")} placement="bottom">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn portal-topbar-language-btn"
                  icon={<Globe2 size={18} />}
                  onClick={toggleLocale}
                  aria-label={t("language.switchTo")}
                />
              </Tooltip>
            ) : null}
            {showRightPanelToggle ? (
              <Tooltip title={isRightPanelOpen ? t("topbar.closePanel") : t("topbar.openPanel")} placement="bottomLeft">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={isRightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
                  onClick={props.onToggleDrawer}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label={t("topbar.togglePanel")}
                />
              </Tooltip>
            ) : null}
            {isMobile && hasOverflowActions ? (
              <Tooltip title={t("topbar.more")} placement="bottomLeft">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={<Ellipsis size={18} />}
                  onClick={() => setMobileActionsOpen(true)}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label={t("topbar.more")}
                />
              </Tooltip>
            ) : null}
          </Space>
        </div>
      </header>

      {isMobile ? (
        <Drawer
          placement="bottom"
          title={t("topbar.actions")}
          open={mobileActionsOpen}
          onClose={() => setMobileActionsOpen(false)}
          height="auto"
          rootClassName="portal-topbar-mobile-actions-drawer"
          destroyOnHidden
        >
          <div className="portal-topbar-mobile-actions-sheet">
            {showRuntimeSummary && props.runtimeSummary ? (
              <section className="portal-topbar-mobile-actions-summary">
                <p className="portal-topbar-mobile-actions-eyebrow">{t("topbar.runtime")}</p>
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
