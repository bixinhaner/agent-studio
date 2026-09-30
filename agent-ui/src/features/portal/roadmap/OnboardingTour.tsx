import { Tour, type TourProps } from "antd";
import { useMemo } from "react";

import { usePortalI18n, type PortalMessageKey } from "../i18n";

export const TOUR_STEPS = ["workspace", "attach", "skills", "steer", "outputs"] as const;
export type TourStepKey = (typeof TOUR_STEPS)[number];

/** Elements opt in with `data-tour="<step>"`; missing targets fall back to a centered card. */
function tourTarget(key: TourStepKey): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`));
  return candidates.find((element) => element.getClientRects().length > 0) ?? null;
}

export function OnboardingTour(props: { open: boolean; onClose(completed: boolean): void }) {
  const { t } = usePortalI18n();
  const steps = useMemo<TourProps["steps"]>(
    () =>
      TOUR_STEPS.map((key, index) => ({
        title: t(`tour.${key}.title` as PortalMessageKey),
        description: t(`tour.${key}.body` as PortalMessageKey),
        target: () => tourTarget(key) as HTMLElement,
        nextButtonProps: { children: index === TOUR_STEPS.length - 1 ? t("tour.finish") : t("tour.next") },
        prevButtonProps: { children: t("tour.prev") }
      })),
    [t]
  );
  return (
    <Tour
      open={props.open}
      steps={steps}
      rootClassName="roadmap-tour"
      onClose={() => props.onClose(false)}
      onFinish={() => props.onClose(true)}
      indicatorsRender={(current, total) => (
        <span className="roadmap-tour-indicator">
          {current + 1} / {total}
          <button type="button" className="roadmap-tour-skip" onClick={() => props.onClose(false)}>
            {t("tour.skip")}
          </button>
        </span>
      )}
    />
  );
}
