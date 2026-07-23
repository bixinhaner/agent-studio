import { useMemo, useState } from "react";
import { Button, Drawer, Dropdown, Space, Tooltip, type MenuProps } from "antd";
import {
  Check,
  Ellipsis,
  CreditCard,
  Globe,
  LayoutPanelLeft,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Shield
} from "lucide-react";

import { BrandMark } from "../../branding/BrandMark";
import { useBranding } from "../../branding/BrandingProvider";
import { usePortalI18n, type PortalLocale } from "../i18n";

const PORTAL_LANGUAGE_OPTIONS: ReadonlyArray<{ key: PortalLocale; label: string }> = [
  { key: "en", label: "English" },
  { key: "zh-CN", label: "简体中文" }
];

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
  const { locale, setLocale, t } = usePortalI18n();
  const isRightPanelOpen = props.drawerOpen;
  const showRuntimeSummary = props.showRuntimeSummary ?? true;
  const showAdvancedSettings = props.showAdvancedSettings ?? true;
  const showRightPanelToggle = props.showRightPanelToggle ?? true;
  const isMobile = props.mobile ?? false;
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
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
        : null
    ].filter(Boolean) as Array<{
      key: string;
      label: string;
      icon: JSX.Element;
      onClick(): void;
    }>,
    [props.onOpenAdmin, props.onOpenAdvancedSettings, props.onOpenBilling, props.onOpenFeedback, showAdvancedSettings, t]
  );
  const languageMenu: MenuProps = {
    items: PORTAL_LANGUAGE_OPTIONS.map((option) => ({
      key: option.key,
      label: option.label,
      icon: (
        <span className="portal-language-option-check" aria-hidden="true">
          {locale === option.key ? <Check size={14} strokeWidth={2.3} /> : null}
        </span>
      )
    })),
    selectable: true,
    selectedKeys: [locale],
    onClick: ({ key }) => setLocale(key as PortalLocale)
  };

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
              <Dropdown
                menu={languageMenu}
                trigger={["hover", "click"]}
                placement="bottomRight"
                mouseEnterDelay={0.08}
                mouseLeaveDelay={0.14}
                overlayClassName="portal-language-dropdown"
                open={languageMenuOpen}
                onOpenChange={setLanguageMenuOpen}
              >
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn portal-topbar-language-btn"
                  icon={<Globe size={18} />}
                  aria-label={t("language.select")}
                  aria-haspopup="menu"
                  aria-expanded={languageMenuOpen}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
                      event.preventDefault();
                      setLanguageMenuOpen(true);
                    }
                  }}
                />
              </Dropdown>
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
            <section className="portal-topbar-mobile-language" aria-label={t("language.select")}>
              <p>{t("language.select")}</p>
              <div>
                {PORTAL_LANGUAGE_OPTIONS.map((option) => (
                  <Button
                    key={option.key}
                    type="default"
                    className={locale === option.key ? "is-selected" : ""}
                    icon={locale === option.key ? <Check size={16} /> : undefined}
                    aria-pressed={locale === option.key}
                    onClick={() => {
                      setLocale(option.key);
                      setMobileActionsOpen(false);
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </section>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
