import { useMemo, useState } from "react";
import { Button, Drawer, Dropdown, Space, Tooltip, type MenuProps } from "antd";
import {
  Check,
  ArrowLeft,
  BarChart3,
  BellRing,
  BookOpen,
  Brain,
  CalendarClock,
  Compass,
  Monitor,
  Moon,
  Sun,
  CircleHelp,
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
import { usePortalRoadmap } from "../roadmap/PortalRoadmapContext";
import type { PortalThemePreference } from "../roadmap/use-portal-theme";

const THEME_OPTIONS: ReadonlyArray<{ key: PortalThemePreference; icon: JSX.Element }> = [
  { key: "light", icon: <Sun size={16} /> },
  { key: "dark", icon: <Moon size={16} /> },
  { key: "system", icon: <Monitor size={16} /> }
];

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
  trainingMode?: boolean;
  onOpenTraining?: () => void;
  onExitTraining?: () => void;
}) {
  const { branding } = useBranding();
  const { languageSwitcherEnabled, locale, setLocale, t } = usePortalI18n();
  const isRightPanelOpen = props.drawerOpen;
  const showRuntimeSummary = props.showRuntimeSummary ?? true;
  const showAdvancedSettings = props.showAdvancedSettings ?? true;
  const showRightPanelToggle = props.showRightPanelToggle ?? true;
  const isMobile = props.mobile ?? false;
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const roadmap = usePortalRoadmap();
  const personalEnabled = Boolean(roadmap?.personalFeaturesEnabled);
  const tourEnabled = Boolean(roadmap?.tourEnabled);
  const showHelpMenu = Boolean(props.onOpenTraining) || tourEnabled || Boolean(props.onOpenFeedback);
  // Preferences live in the account menu; training mode has no account card, so keep them here.
  const showPreferenceButtons = Boolean(props.trainingMode);
  const themeMenu: MenuProps | null = roadmap
    ? {
        items: THEME_OPTIONS.map((option) => ({
          key: option.key,
          icon: option.icon,
          label: (
            <span className="portal-theme-option">
              {t(`theme.${option.key}`)}
              {roadmap.theme.preference === option.key ? <Check size={14} strokeWidth={2.3} aria-hidden="true" /> : null}
            </span>
          )
        })),
        selectable: true,
        selectedKeys: [roadmap.theme.preference],
        onClick: ({ key }) => roadmap.theme.setPreference(key as PortalThemePreference)
      }
    : null;
  const mobileActionItems = useMemo(
    () => [
      personalEnabled
        ? {
            key: "tasks",
            label: t("menu.scheduledTasks"),
            icon: <CalendarClock size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              roadmap?.openScheduledTasks();
            }
          }
        : null,
      roadmap?.usageEnabled
        ? {
            key: "usage",
            label: t("account.usage"),
            icon: <BarChart3 size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              roadmap?.openUsage();
            }
          }
        : null,
      personalEnabled
        ? {
            key: "memory",
            label: t("menu.memory"),
            icon: <Brain size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              roadmap?.openMemory();
            }
          }
        : null,
      personalEnabled
        ? {
            key: "notifications",
            label: t("account.notifications"),
            icon: <BellRing size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              roadmap?.openNotificationSettings();
            }
          }
        : null,
      props.trainingMode && props.onExitTraining
        ? {
            key: "exit-training",
            label: t("training.backToWorkspace"),
            icon: <ArrowLeft size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              props.onExitTraining?.();
            }
          }
        : null,
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
      props.onOpenTraining
        ? {
            key: "training",
            label: t("training.open"),
            icon: <BookOpen size={18} />,
            onClick: () => {
              setMobileActionsOpen(false);
              props.onOpenTraining?.();
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
    [personalEnabled, props.onExitTraining, props.onOpenAdmin, props.onOpenAdvancedSettings, props.onOpenBilling, props.onOpenFeedback, props.onOpenTraining, props.trainingMode, roadmap, showAdvancedSettings, t]
  );
  const hasOverflowActions = languageSwitcherEnabled || Boolean(themeMenu) || mobileActionItems.length > 0;
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
              aria-expanded={!props.sessionRailCollapsed}
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
          {props.trainingMode ? (
            <span className="portal-topbar-training-badge">
              <BookOpen size={15} aria-hidden="true" />
              {t("training.readOnlyBadge")}
            </span>
          ) : null}
          {!isMobile && showRuntimeSummary && props.runtimeSummary ? (
            <span className="portal-topbar-runtime-chip" title={props.runtimeSummary}>
              {props.runtimeSummary}
            </span>
          ) : null}

          <Space size={8} className="portal-topbar-action-group">
            {!isMobile && showHelpMenu ? (
              <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                open={helpMenuOpen}
                onOpenChange={setHelpMenuOpen}
                menu={{
                  items: [
                    props.onOpenTraining
                      ? {
                          key: "training",
                          icon: <BookOpen size={17} />,
                          label: (
                            <span className="portal-training-help-item">
                              <strong>{t("training.open")}</strong>
                              <small>{t("training.openDetail")}</small>
                            </span>
                          )
                        }
                      : null,
                    tourEnabled
                      ? {
                          key: "tour",
                          icon: <Compass size={17} />,
                          label: (
                            <span className="portal-training-help-item">
                              <strong>{t("menu.tour")}</strong>
                              <small>{t("menu.tourDetail")}</small>
                            </span>
                          )
                        }
                      : null,
                    props.onOpenFeedback
                      ? {
                          key: "feedback",
                          icon: <MessageSquareText size={17} />,
                          label: (
                            <span className="portal-training-help-item">
                              <strong>{t("topbar.feedback")}</strong>
                              <small>{t("menu.feedbackDetail")}</small>
                            </span>
                          )
                        }
                      : null
                  ].filter(Boolean) as NonNullable<MenuProps["items"]>,
                  onClick: ({ key }) => {
                    setHelpMenuOpen(false);
                    if (key === "tour") roadmap?.startTour();
                    else if (key === "feedback") props.onOpenFeedback?.();
                    else props.onOpenTraining?.();
                  }
                }}
              >
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={<CircleHelp size={18} />}
                  aria-label={t("topbar.help")}
                  aria-haspopup="menu"
                  aria-expanded={helpMenuOpen}
                />
              </Dropdown>
            ) : null}
            {!isMobile && props.trainingMode && props.onExitTraining ? (
              <Button
                className="portal-training-exit-btn"
                icon={<ArrowLeft size={16} />}
                onClick={props.onExitTraining}
              >
                {t("training.backToWorkspace")}
              </Button>
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
            {!isMobile && showPreferenceButtons && themeMenu && roadmap ? (
              <Dropdown menu={themeMenu} trigger={["click"]} placement="bottomRight" overlayClassName="portal-language-dropdown">
                <Button
                  type="text"
                  className="portal-topbar-ghost-btn"
                  icon={roadmap.theme.resolved === "dark" ? <Moon size={18} /> : <Sun size={18} />}
                  aria-label={t("menu.theme")}
                  aria-haspopup="menu"
                />
              </Dropdown>
            ) : null}
            {!isMobile && showPreferenceButtons && languageSwitcherEnabled ? (
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
                  data-tour="outputs"
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
            {roadmap ? (
              <section className="portal-topbar-mobile-language" aria-label={t("menu.theme")}>
                <p>{t("menu.theme")}</p>
                <div>
                  {THEME_OPTIONS.map((option) => (
                    <Button
                      key={option.key}
                      type="default"
                      className={roadmap.theme.preference === option.key ? "is-selected" : ""}
                      icon={option.icon}
                      aria-pressed={roadmap.theme.preference === option.key}
                      onClick={() => roadmap.theme.setPreference(option.key)}
                    >
                      {t(`theme.${option.key}`)}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}
            {tourEnabled ? (
              <Button
                type="default"
                className="portal-topbar-mobile-action-btn"
                icon={<Compass size={18} />}
                block
                onClick={() => {
                  setMobileActionsOpen(false);
                  roadmap?.startTour();
                }}
              >
                {t("menu.tour")}
              </Button>
            ) : null}
            {languageSwitcherEnabled ? <section className="portal-topbar-mobile-language" aria-label={t("language.select")}>
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
            </section> : null}
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
