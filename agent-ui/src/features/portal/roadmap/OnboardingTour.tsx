import { X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { usePortalI18n, type PortalMessageKey } from "../i18n";

export const TOUR_STEPS = ["workspace", "attach", "skills", "steer", "outputs"] as const;
export type TourStepKey = (typeof TOUR_STEPS)[number];

type Placement = "right" | "top" | "bottom-end";
const PLACEMENT: Record<TourStepKey, Placement> = {
  workspace: "right",
  attach: "top",
  skills: "top",
  steer: "top",
  outputs: "bottom-end"
};

const GAP = 12;
const PAD = 6;
const EDGE = 12;
const CARD_WIDTH = 340;

/** Elements opt in with `data-tour="<step>"`; only visible ones count. */
export function tourTarget(key: TourStepKey): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`));
  return (
    candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) ?? null
  );
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * The desktop workbench applies `zoom` to <body>. Target rects come back in
 * visual pixels while our fixed layer is laid out in body CSS pixels, so the
 * layer measures its own scale and converts (works with or without zoom).
 */
function measure(layer: HTMLElement, target: HTMLElement | null) {
  const layerRect = layer.getBoundingClientRect();
  const scale = layer.offsetWidth > 0 ? layerRect.width / layer.offsetWidth : 1;
  const viewport = { width: layer.offsetWidth, height: layer.offsetHeight };
  if (!target) return { viewport, hole: null as Box | null };
  const rect = target.getBoundingClientRect();
  const hole = {
    left: (rect.left - layerRect.left) / scale - PAD,
    top: (rect.top - layerRect.top) / scale - PAD,
    width: rect.width / scale + PAD * 2,
    height: rect.height / scale + PAD * 2
  };
  return { viewport, hole };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function placeCard(placement: Placement, hole: Box | null, viewport: { width: number; height: number }, card: { width: number; height: number }) {
  if (!hole) {
    return { left: (viewport.width - card.width) / 2, top: (viewport.height - card.height) / 2, arrow: null as null | { side: "left" | "bottom" | "top"; offset: number } };
  }
  let left: number;
  let top: number;
  let side: "left" | "bottom" | "top";
  if (placement === "right" && hole.left + hole.width + GAP + card.width <= viewport.width - EDGE) {
    left = hole.left + hole.width + GAP;
    top = clamp(hole.top + Math.min(hole.height / 2, 120) - 40, EDGE, viewport.height - card.height - EDGE);
    side = "left";
  } else if (placement === "bottom-end" || hole.top - GAP - card.height < EDGE) {
    left = clamp(hole.left + hole.width - card.width, EDGE, viewport.width - card.width - EDGE);
    top = clamp(hole.top + hole.height + GAP, EDGE, viewport.height - card.height - EDGE);
    side = "top";
  } else {
    left = clamp(hole.left + hole.width / 2 - 48, EDGE, viewport.width - card.width - EDGE);
    top = hole.top - GAP - card.height;
    side = "bottom";
  }
  const offset =
    side === "left"
      ? clamp(hole.top + hole.height / 2 - top, 16, card.height - 16)
      : clamp(hole.left + hole.width / 2 - left, 16, card.width - 16);
  return { left, top, arrow: { side, offset } };
}

/**
 * Lightweight spotlight tour. antd Tour mis-measures under the workbench
 * body zoom (partial mask, misaligned card), so this renders in body space.
 * `prepare` lets the shell switch to a view where the composer exists.
 */
export function OnboardingTour(props: { open: boolean; prepare?(): void | Promise<unknown>; onClose(completed: boolean): void }) {
  const { t } = usePortalI18n();
  const titleId = useId();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [steps, setSteps] = useState<TourStepKey[] | null>(null);
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<{ hole: Box | null; card: { left: number; top: number }; arrow: ReturnType<typeof placeCard>["arrow"] } | null>(null);
  const { open, prepare, onClose } = props;

  // Resolve which steps have a visible target once the view is ready.
  useEffect(() => {
    if (!open) {
      setSteps(null);
      setLayout(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await prepare?.();
      } catch {
        /* the tour still works with centered cards */
      }
      // Wait (briefly) for the composer to mount after switching views.
      for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
        if (tourTarget("steer")) break;
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      if (cancelled) return;
      const available = TOUR_STEPS.filter((key) => tourTarget(key));
      setIndex(0);
      setSteps(available.length ? available : [...TOUR_STEPS]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, prepare]);

  const stepKey = steps?.[index] ?? null;

  const relayout = useCallback(() => {
    const layer = layerRef.current;
    const card = cardRef.current;
    if (!layer || !card || !stepKey) return;
    const target = tourTarget(stepKey);
    const { viewport, hole } = measure(layer, target);
    const cardBox = { width: card.offsetWidth, height: card.offsetHeight };
    const placed = placeCard(PLACEMENT[stepKey], hole, viewport, cardBox);
    setLayout({ hole, card: { left: placed.left, top: placed.top }, arrow: placed.arrow });
  }, [stepKey]);

  useLayoutEffect(() => {
    if (!stepKey) return;
    const target = tourTarget(stepKey);
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    relayout();
    cardRef.current?.focus({ preventScroll: true });
  }, [relayout, stepKey]);

  useEffect(() => {
    if (!stepKey) return undefined;
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", relayout, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => relayout());
    if (observer && cardRef.current) observer.observe(cardRef.current);
    return () => {
      window.removeEventListener("resize", relayout);
      window.removeEventListener("scroll", relayout, true);
      observer?.disconnect();
    };
  }, [relayout, stepKey]);

  const total = steps?.length ?? 0;
  const isLast = index >= total - 1;
  const next = useCallback(() => {
    if (isLast) onClose(true);
    else setIndex((current) => current + 1);
  }, [isLast, onClose]);
  const prev = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);

  useEffect(() => {
    if (!stepKey) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(false);
      } else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, onClose, prev, stepKey]);

  const holeStyle = useMemo<CSSProperties | undefined>(
    () =>
      layout?.hole
        ? { left: layout.hole.left, top: layout.hole.top, width: layout.hole.width, height: layout.hole.height }
        : undefined,
    [layout]
  );

  if (!open || !stepKey || typeof document === "undefined") return null;

  return createPortal(
    <div ref={layerRef} className="roadmap-tour-layer" data-ready={layout ? "true" : "false"}>
      {holeStyle ? <div className="roadmap-tour-hole" style={holeStyle} aria-hidden="true" /> : <div className="roadmap-tour-backdrop" aria-hidden="true" />}
      <div
        ref={cardRef}
        className="roadmap-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: CARD_WIDTH, left: layout?.card.left ?? 0, top: layout?.card.top ?? 0 }}
      >
        {layout?.arrow ? (
          <span
            className={`roadmap-tour-arrow is-${layout.arrow.side}`}
            style={layout.arrow.side === "left" ? { top: layout.arrow.offset } : { left: layout.arrow.offset }}
            aria-hidden="true"
          />
        ) : null}
        <div className="roadmap-tour-head">
          <strong id={titleId}>{t(`tour.${stepKey}.title` as PortalMessageKey)}</strong>
          <button type="button" className="roadmap-tour-close" onClick={() => onClose(false)} aria-label={t("tour.close")}>
            <X size={15} />
          </button>
        </div>
        <p className="roadmap-tour-body">{t(`tour.${stepKey}.body` as PortalMessageKey)}</p>
        <div className="roadmap-tour-foot">
          <span className="roadmap-tour-indicator">
            {index + 1} / {total}
            {!isLast ? (
              <button type="button" className="roadmap-tour-skip" onClick={() => onClose(false)}>
                {t("tour.skip")}
              </button>
            ) : null}
          </span>
          <span className="roadmap-tour-actions">
            {index > 0 ? (
              <button type="button" className="roadmap-tour-btn" onClick={prev}>
                {t("tour.prev")}
              </button>
            ) : null}
            <button type="button" className="roadmap-tour-btn is-primary" onClick={next}>
              {isLast ? t("tour.finish") : t("tour.next")}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
