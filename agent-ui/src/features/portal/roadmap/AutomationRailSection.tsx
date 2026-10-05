import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";

import { usePortalI18n } from "../i18n";
import { listScheduledTasks } from "./api";
import { usePortalRoadmap } from "./PortalRoadmapContext";

type Summary = { total: number; active: number; failing: number };

/**
 * Scheduled tasks are work the user hands to Bailey and comes back to check,
 * so they sit in the workspace rail with a live status instead of a menu.
 */
export function AutomationRailSection() {
  const { t } = usePortalI18n();
  const roadmap = usePortalRoadmap();
  const [summary, setSummary] = useState<Summary | null>(null);
  const version = roadmap?.scheduledTasksVersion ?? 0;
  const enabled = Boolean(roadmap?.personalFeaturesEnabled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void listScheduledTasks()
      .then((result) => {
        if (cancelled) return;
        setSummary({
          total: result.tasks.length,
          active: result.tasks.filter((task) => task.enabled).length,
          failing: result.tasks.filter((task) => task.enabled && task.last_run_status === "failed").length
        });
      })
      .catch(() => !cancelled && setSummary(null));
    return () => {
      cancelled = true;
    };
  }, [enabled, version]);

  if (!roadmap || !enabled) return null;
  const status = summary?.failing
    ? t("rail.scheduledFailed")
    : summary?.active
      ? t("rail.scheduledActive", { count: summary.active })
      : summary?.total
        ? t("rail.scheduledPaused", { count: summary.total })
        : summary
          ? t("rail.scheduledNone")
        : "";

  return (
    <nav className="workspace-automation-nav" aria-label={t("rail.automation")}>
      <div className="workspace-nav-section-label">
        <span>{t("rail.automation")}</span>
      </div>
      <button type="button" className="workspace-nav-item workspace-automation-item" onClick={() => roadmap.openScheduledTasks()}>
        <CalendarClock size={17} aria-hidden="true" />
        <span>{t("menu.scheduledTasks")}</span>
        {status ? (
          <small className={summary?.failing ? "workspace-automation-status is-failing" : "workspace-automation-status"}>
            {summary?.failing ? <i aria-hidden="true" /> : null}
            {status}
          </small>
        ) : null}
      </button>
    </nav>
  );
}
