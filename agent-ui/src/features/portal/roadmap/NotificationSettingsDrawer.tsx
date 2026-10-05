import { useEffect, useState } from "react";
import { Button, Drawer, Switch } from "antd";
import { Bell, CalendarClock, MessageCircle } from "lucide-react";

import { usePortalI18n } from "../i18n";
import { listScheduledTasks } from "./api";
import { readDesktopNotifyMuted, writeDesktopNotifyMuted } from "./run-attention";

type Permission = NotificationPermission | "unsupported";

function currentPermission(): Permission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function NotificationSettingsDrawer(props: { open: boolean; onClose(): void; onOpenScheduledTasks?(): void }) {
  const { t } = usePortalI18n();
  const [permission, setPermission] = useState<Permission>(currentPermission);
  const [muted, setMuted] = useState(readDesktopNotifyMuted);
  // Server-side check: the user has a DingTalk id and the push channel is configured.
  const [dingtalkBound, setDingtalkBound] = useState<boolean | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setPermission(currentPermission());
    setMuted(readDesktopNotifyMuted());
    let cancelled = false;
    void listScheduledTasks()
      .then((result) => !cancelled && setDingtalkBound(result.dingtalk_available))
      .catch(() => !cancelled && setDingtalkBound(false));
    return () => {
      cancelled = true;
    };
  }, [props.open]);

  const desktopOn = permission === "granted" && !muted;
  const toggleDesktop = async (next: boolean) => {
    if (!next) {
      writeDesktopNotifyMuted(true);
      setMuted(true);
      return;
    }
    writeDesktopNotifyMuted(false);
    setMuted(false);
    if (permission === "default") {
      try {
        setPermission(await Notification.requestPermission());
      } catch {
        setPermission(currentPermission());
      }
    }
  };

  const desktopStatus =
    permission === "unsupported"
      ? t("notifySettings.unsupported")
      : permission === "denied"
        ? t("notifySettings.permissionDenied")
        : permission === "default"
          ? t("notifySettings.permissionDefault")
          : t("notifySettings.desktopHint");

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      width={440}
      rootClassName="roadmap-drawer"
      title={
        <span className="roadmap-drawer-title">
          <Bell size={18} aria-hidden="true" />
          {t("notifySettings.title")}
        </span>
      }
    >
      <div className="notify-settings">
        <section className="notify-settings-row">
          <Bell size={18} aria-hidden="true" />
          <div>
            <strong id="notify-desktop-label">{t("notifySettings.desktop")}</strong>
            <p>{desktopStatus}</p>
          </div>
          <Switch
            aria-labelledby="notify-desktop-label"
            checked={desktopOn}
            disabled={permission === "unsupported" || permission === "denied"}
            onChange={(next) => void toggleDesktop(next)}
          />
        </section>
        <section className="notify-settings-row">
          <MessageCircle size={18} aria-hidden="true" />
          <div>
            <strong>{t("notifySettings.dingtalk")}</strong>
            <p>{dingtalkBound === null ? "…" : dingtalkBound ? t("notifySettings.dingtalkBound") : t("notifySettings.dingtalkUnbound")}</p>
            {props.onOpenScheduledTasks ? (
              <Button size="small" icon={<CalendarClock size={14} />} onClick={props.onOpenScheduledTasks}>
                {t("notifySettings.openTasks")}
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </Drawer>
  );
}
