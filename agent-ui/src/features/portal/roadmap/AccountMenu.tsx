import { useEffect, useState, type ReactNode } from "react";
import { Popover, Segmented, Select } from "antd";
import {
  BarChart3,
  BellRing,
  Brain,
  ChevronRight,
  ChevronsUpDown,
  Compass,
  CreditCard,
  Gauge,
  LogOut,
  MessageSquareText,
  Monitor,
  Moon,
  Settings,
  Sun
} from "lucide-react";

import { useAuth } from "../../auth/AuthProvider";
import type { AuthUser } from "../../auth/api";
import { roleLabel, UserAccessStatusPanel, type UserAccessStatus } from "../../auth/UserIdentitySummary";
import { usePortalI18n, type PortalLocale } from "../i18n";
import { fetchPersonalUsage } from "./api";
import { usePortalRoadmap } from "./PortalRoadmapContext";
import { browserTimezone } from "./schedule-format";
import { formatTokens } from "./UsageDrawer";
import type { PortalThemePreference } from "./use-portal-theme";

function MenuItem(props: { icon: ReactNode; label: string; detail?: string; onClick(): void; trailing?: ReactNode; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" className={props.danger ? "account-menu-item is-danger" : "account-menu-item"} onClick={props.onClick}>
      <span className="account-menu-item-icon" aria-hidden="true">{props.icon}</span>
      <span className="account-menu-item-copy">
        <strong>{props.label}</strong>
        {props.detail ? <small>{props.detail}</small> : null}
      </span>
      {props.trailing ?? null}
    </button>
  );
}

/**
 * Portal account card + menu. Personal views (usage, memory, notifications),
 * preferences (appearance, language, runtime) and account actions live here
 * instead of the top bar, which keeps only task-level controls.
 */
export function AccountMenu(props: {
  user: AuthUser;
  accessStatus?: UserAccessStatus | null;
  accessStatusLoading?: boolean;
  accessStatusError?: string;
  onOpenAccessStatus?(): void;
  onOpenBilling?(): void;
  onOpenAdvancedSettings?(): void;
  onOpenFeedback?(): void;
  onSignOut?(): void;
}) {
  const { t, locale, setLocale, languageSwitcherEnabled, intlLocale } = usePortalI18n();
  const auth = useAuth();
  const roadmap = usePortalRoadmap();
  const [open, setOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [monthTokens, setMonthTokens] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const identityLocale = locale === "zh-CN" ? "zh" : "en";
  const name = props.user.displayName?.trim() || props.user.email?.trim() || props.user.id;
  const email = props.user.email?.trim() || "";
  const organizationName = auth.activeOrganization?.name?.trim() || "";
  const organizations = auth.memberships.filter((membership) => membership.organization);
  const usageEnabled = Boolean(roadmap?.usageEnabled);
  const personal = Boolean(roadmap?.personalFeaturesEnabled);

  // The card shows this month's tokens; refresh whenever the menu closes.
  useEffect(() => {
    if (!usageEnabled || open) return;
    let cancelled = false;
    void fetchPersonalUsage("month", browserTimezone())
      .then((summary) => !cancelled && setMonthTokens(summary.totals.total_tokens))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, usageEnabled]);

  const run = (action?: () => void) => () => {
    setOpen(false);
    setAccessOpen(false);
    action?.();
  };

  const signOut = () => {
    if (!props.onSignOut) return;
    setOpen(false);
    if (!window.confirm(t("account.signOutConfirm"))) return;
    props.onSignOut();
  };

  const switchOrganization = async (organizationId: string) => {
    if (!organizationId || organizationId === auth.activeOrganization?.id) return;
    setSwitching(true);
    try {
      await auth.selectOrganization(organizationId);
    } finally {
      setSwitching(false);
    }
  };

  const content = (
    <div className="account-menu" role="menu" aria-label={t("account.label")}>
      <header className="account-menu-head">
        <strong>{name}</strong>
        {email ? <span>{email}</span> : null}
        <span>
          {roleLabel(props.user.role, props.user.userType, identityLocale)}
          {organizationName ? ` · ${organizationName}` : ""}
        </span>
        {organizations.length > 1 ? (
          <Select
            size="small"
            className="account-menu-org"
            aria-label={t("account.switchOrg")}
            value={auth.activeOrganization?.id}
            loading={switching}
            disabled={switching}
            popupMatchSelectWidth={false}
            getPopupContainer={(node) => node.parentElement ?? document.body}
            onChange={(value) => void switchOrganization(value)}
            options={organizations.map((membership) => ({ value: membership.organization!.id, label: membership.organization!.name }))}
          />
        ) : null}
      </header>

      <div className="account-menu-group">
        {usageEnabled ? (
          <MenuItem
            icon={<BarChart3 size={17} />}
            label={t("account.usage")}
            detail={monthTokens !== null ? t("account.monthTokens", { count: formatTokens(monthTokens, intlLocale) }) : t("account.usageDetail")}
            trailing={<ChevronRight size={14} className="account-menu-chevron" />}
            onClick={run(() => roadmap?.openUsage())}
          />
        ) : null}
        {props.onOpenAccessStatus ? (
          <>
            <MenuItem
              icon={<Gauge size={17} />}
              label={t("account.access")}
              trailing={<ChevronRight size={14} className={accessOpen ? "account-menu-chevron is-open" : "account-menu-chevron"} />}
              onClick={() => {
                const next = !accessOpen;
                setAccessOpen(next);
                if (next) props.onOpenAccessStatus?.();
              }}
            />
            {accessOpen ? (
              <div className="account-menu-access">
                <UserAccessStatusPanel
                  locale={identityLocale}
                  accessStatus={props.accessStatus}
                  loading={props.accessStatusLoading}
                  error={props.accessStatusError}
                />
              </div>
            ) : null}
          </>
        ) : null}
        {props.onOpenBilling ? <MenuItem icon={<CreditCard size={17} />} label={t("account.billing")} onClick={run(props.onOpenBilling)} /> : null}
      </div>

      {personal ? (
        <div className="account-menu-group">
          <span className="account-menu-group-label">{t("account.personal")}</span>
          <MenuItem icon={<Brain size={17} />} label={t("menu.memory")} detail={t("menu.memoryDetail")} onClick={run(() => roadmap?.openMemory())} />
          <MenuItem icon={<BellRing size={17} />} label={t("account.notifications")} onClick={run(() => roadmap?.openNotificationSettings())} />
        </div>
      ) : null}

      <div className="account-menu-group">
        <span className="account-menu-group-label">{t("account.preferences")}</span>
        {roadmap ? (
          <div className="account-menu-setting">
            <span id="account-theme-label">{t("menu.theme")}</span>
            <Segmented
              size="small"
              aria-labelledby="account-theme-label"
              value={roadmap.theme.preference}
              onChange={(value) => roadmap.theme.setPreference(value as PortalThemePreference)}
              options={[
                { value: "light", icon: <Sun size={14} />, title: t("theme.light") },
                { value: "dark", icon: <Moon size={14} />, title: t("theme.dark") },
                { value: "system", icon: <Monitor size={14} />, title: t("theme.system") }
              ]}
            />
          </div>
        ) : null}
        {languageSwitcherEnabled ? (
          <div className="account-menu-setting">
            <span id="account-language-label">{t("account.language")}</span>
            <Segmented
              size="small"
              aria-labelledby="account-language-label"
              value={locale}
              onChange={(value) => setLocale(value as PortalLocale)}
              options={[
                { value: "zh-CN", label: "中文" },
                { value: "en", label: "English" }
              ]}
            />
          </div>
        ) : null}
        {props.onOpenAdvancedSettings ? (
          <MenuItem icon={<Settings size={17} />} label={t("account.runtime")} onClick={run(props.onOpenAdvancedSettings)} />
        ) : null}
      </div>

      <div className="account-menu-group account-menu-foot">
        {roadmap?.tourEnabled ? <MenuItem icon={<Compass size={17} />} label={t("menu.tour")} onClick={run(() => roadmap.startTour())} /> : null}
        {props.onOpenFeedback ? <MenuItem icon={<MessageSquareText size={17} />} label={t("account.feedback")} onClick={run(props.onOpenFeedback)} /> : null}
        {props.onSignOut ? <MenuItem icon={<LogOut size={17} />} label={t("account.signOut")} onClick={signOut} danger /> : null}
      </div>
    </div>
  );

  const blocked = props.accessStatus?.accessState === "blocked";
  return (
    <Popover
      trigger="click"
      placement="topLeft"
      arrow={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAccessOpen(false);
      }}
      content={content}
      overlayClassName="account-menu-popover"
    >
      <button type="button" className="account-card" aria-haspopup="menu" aria-expanded={open} aria-label={t("account.open")}>
        <span className="account-card-avatar" aria-hidden="true">
          {Array.from(name)[0]?.toUpperCase()}
          {blocked ? <i className="account-card-alert" /> : null}
        </span>
        <span className="account-card-copy">
          <strong>{name}</strong>
          <small>
            {monthTokens !== null
              ? t("account.monthTokens", { count: formatTokens(monthTokens, intlLocale) })
              : [roleLabel(props.user.role, props.user.userType, identityLocale), organizationName].filter(Boolean).join(" · ")}
          </small>
        </span>
        <ChevronsUpDown size={15} className="account-card-chevron" aria-hidden="true" />
      </button>
    </Popover>
  );
}
