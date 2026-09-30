import { useEffect, useRef } from "react";
import { Button, notification } from "antd";
import { BellRing } from "lucide-react";

import { usePortalI18n } from "../i18n";

const RUN_FINISHED_EVENT = "agent-studio:portal-run-finished";
const PERMISSION_PROMPT_KEY = "agent-studio.portal.notify-prompt.v1";

export type PortalRunFinishedDetail = { threadId: string; status: "completed" | "failed" };

export function dispatchPortalRunFinished(detail: PortalRunFinishedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PortalRunFinishedDetail>(RUN_FINISHED_EVENT, { detail }));
}

function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function promptAlreadyHandled(): boolean {
  try {
    return window.localStorage.getItem(PERMISSION_PROMPT_KEY) === "1";
  } catch {
    return true;
  }
}

function markPromptHandled() {
  try {
    window.localStorage.setItem(PERMISSION_PROMPT_KEY, "1");
  } catch {
    // Ignore blocked storage; the prompt may show again next session.
  }
}

/**
 * When a run finishes while the tab is hidden: "✓ 已完成" / unread count in the
 * tab title and a desktop notification (if permitted). The title is restored as
 * soon as the tab becomes visible again.
 */
export function useRunCompletionAttention(options: {
  enabled: boolean;
  resolveThreadTitle(threadId: string): string | undefined;
  onOpenThread(threadId: string): void;
}) {
  const { t } = usePortalI18n();
  const [notifyApi, notifyHolder] = notification.useNotification();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const tRef = useRef(t);
  tRef.current = t;
  const unreadRef = useRef(0);
  const baseTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!options.enabled) return;
    const restoreTitle = () => {
      if (baseTitleRef.current !== null) document.title = baseTitleRef.current;
      baseTitleRef.current = null;
      unreadRef.current = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") restoreTitle();
    };

    const maybePromptPermission = () => {
      if (!notificationsSupported() || Notification.permission !== "default" || promptAlreadyHandled()) return;
      markPromptHandled();
      const key = "portal-notify-permission";
      notifyApi.open({
        key,
        icon: <BellRing size={18} />,
        message: tRef.current("notify.enable"),
        placement: "bottomRight",
        duration: 12,
        btn: (
          <span className="roadmap-notify-actions">
            <Button size="small" onClick={() => notifyApi.destroy(key)}>
              {tRef.current("notify.dismiss")}
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                notifyApi.destroy(key);
                void Notification.requestPermission().catch(() => undefined);
              }}
            >
              {tRef.current("notify.enableAction")}
            </Button>
          </span>
        )
      });
    };

    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<PortalRunFinishedDetail>).detail;
      if (!detail?.threadId) return;
      if (document.visibilityState === "visible") {
        maybePromptPermission();
        return;
      }
      const translate = tRef.current;
      const threadTitle = optionsRef.current.resolveThreadTitle(detail.threadId)?.trim() || "Bailey";
      if (baseTitleRef.current === null) baseTitleRef.current = document.title;
      unreadRef.current += 1;
      const base = baseTitleRef.current;
      document.title =
        unreadRef.current === 1
          ? translate("notify.completedTitle", { title: base })
          : translate("notify.unreadTitle", { count: unreadRef.current, title: base });

      if (notificationsSupported() && Notification.permission === "granted") {
        try {
          const desktop = new Notification(translate("notify.desktopTitle"), {
            body:
              detail.status === "failed"
                ? translate("notify.failedBody", { title: threadTitle })
                : translate("notify.desktopBody", { title: threadTitle }),
            tag: `agent-studio-run-${detail.threadId}`
          });
          desktop.onclick = () => {
            window.focus();
            optionsRef.current.onOpenThread(detail.threadId);
            desktop.close();
          };
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }
    };

    window.addEventListener(RUN_FINISHED_EVENT, onFinished);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener(RUN_FINISHED_EVENT, onFinished);
      document.removeEventListener("visibilitychange", onVisibility);
      restoreTitle();
    };
  }, [notifyApi, options.enabled]);

  return notifyHolder;
}
