import { type FC, type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ThreadMessage } from "@assistant-ui/react";
import { type PortalLocale, usePortalI18n } from "./i18n";
import { THREAD_USER_NAVIGATE_EVENT } from "./thread-scroll-follow-controller";
import { userTextFromUnknownMessage } from "./thread-title";

export type ThreadQuestionJumpItem = {
  id: string;
  index: number;
  label: string;
};

export function buildThreadQuestionJumpItems(messages: readonly ThreadMessage[], locale: PortalLocale): ThreadQuestionJumpItem[] {
  let questionIndex = 0;
  return messages
    .filter((message) => message.role === "user")
    .map((message) => {
      questionIndex += 1;
      const text = userTextFromUnknownMessage(message)
        .replace(/<uploaded_file[\s\S]*?<\/uploaded_file>/gi, locale === "zh-CN" ? "附件" : "attached file")
        .replace(/\s+/g, " ")
        .trim();
      return {
        id: message.id,
        index: questionIndex,
        label: text || (locale === "zh-CN" ? `问题 ${questionIndex}` : `Question ${questionIndex}`)
      };
    })
    .filter((item) => item.id);
}

export function findThreadQuestionElement(shell: HTMLElement, messageId: string): HTMLElement | null {
  const nodes = shell.querySelectorAll<HTMLElement>(
    '.thread-public-share-message-shell-user[data-thread-message-id]'
  );
  for (const node of nodes) {
    if (node.dataset.threadMessageId === messageId) return node;
  }
  return null;
}

export const ThreadQuestionNavigator: FC<{
  messages: readonly ThreadMessage[];
  shellRef: MutableRefObject<HTMLDivElement | null>;
  disabled?: boolean;
}> = ({ messages, shellRef, disabled }) => {
  const { locale, t } = usePortalI18n();
  const items = useMemo(() => buildThreadQuestionJumpItems(messages, locale), [locale, messages]);
  const [activeId, setActiveId] = useState("");
  const [hoveredId, setHoveredId] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const panelListRef = useRef<HTMLDivElement | null>(null);
  const selectedId = hoveredId || activeId || items[0]?.id || "";

  const refresh = useCallback(() => {
    const shell = shellRef.current;
    if (!shell || items.length < 2) return;
    const viewport = shell.querySelector<HTMLElement>(".aui-thread-viewport");
    if (!viewport) return;

    const viewportRect = viewport.getBoundingClientRect();
    let nextActiveId = items[0]?.id || "";
    let bestDistance = Number.POSITIVE_INFINITY;
    const activeLine = viewport.scrollTop + Math.min(240, viewport.clientHeight * 0.55);

    for (const item of items) {
      const element = findThreadQuestionElement(shell, item.id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const topInScroll = viewport.scrollTop + rect.top - viewportRect.top;
      const distance = Math.abs(topInScroll - activeLine);
      if (topInScroll <= activeLine && distance <= bestDistance) {
        bestDistance = distance;
        nextActiveId = item.id;
      }
    }

    setActiveId((current) => (current === nextActiveId ? current : nextActiveId));
  }, [items, shellRef]);

  useEffect(() => {
    if (disabled || items.length < 2) return;
    const shell = shellRef.current;
    if (!shell) return;
    const viewport = shell.querySelector<HTMLElement>(".aui-thread-viewport");
    if (!viewport) return;

    let frame = 0;
    const scheduleRefresh = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(refresh);
    };

    scheduleRefresh();
    const laterRefresh = window.setTimeout(scheduleRefresh, 250);
    viewport.addEventListener("scroll", scheduleRefresh, { passive: true });
    window.addEventListener("resize", scheduleRefresh);

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleRefresh) : null;
    resizeObserver?.observe(viewport);

    const mutationObserver = typeof MutationObserver !== "undefined" ? new MutationObserver(scheduleRefresh) : null;
    mutationObserver?.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(laterRefresh);
      viewport.removeEventListener("scroll", scheduleRefresh);
      window.removeEventListener("resize", scheduleRefresh);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [disabled, items.length, refresh, shellRef]);

  useEffect(() => {
    setPanelOpen(false);
    setHoveredId("");
  }, [items.length]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!panelOpen || !selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      const row = panelListRef.current?.querySelector<HTMLElement>('[data-question-nav-row-selected="true"]');
      row?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [panelOpen, selectedId]);

  const cancelPanelClose = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const schedulePanelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setPanelOpen(false);
      setHoveredId("");
      closeTimerRef.current = null;
    }, 260);
  }, []);

  const closePanelNow = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setPanelOpen(false);
    setHoveredId("");
  }, []);

  useEffect(() => {
    if (!panelOpen) return;

    const isInsideNavigator = (target: EventTarget | null) => {
      return target instanceof Node && Boolean(navRef.current?.contains(target));
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (isInsideNavigator(event.target)) {
        cancelPanelClose();
        return;
      }
      schedulePanelClose();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (isInsideNavigator(event.target)) return;
      closePanelNow();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanelNow();
      }
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cancelPanelClose, closePanelNow, panelOpen, schedulePanelClose]);

  const openPanelForQuestion = useCallback(
    (messageId?: string) => {
      cancelPanelClose();
      setHoveredId(messageId || activeId || items[0]?.id || "");
      setPanelOpen(true);
    },
    [activeId, cancelPanelClose, items]
  );

  const jumpToQuestion = useCallback(
    (messageId: string) => {
      const shell = shellRef.current;
      if (!shell) return;
      const element = findThreadQuestionElement(shell, messageId);
      if (!element) return;
      const viewport = shell.querySelector<HTMLElement>(".aui-thread-viewport");
      if (viewport) {
        // Leave "follow latest" first, otherwise any content change snaps the view back to the bottom.
        viewport.dispatchEvent(new CustomEvent(THREAD_USER_NAVIGATE_EVENT));
        const viewportRect = viewport.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const top = viewport.scrollTop + rect.top - viewportRect.top - Math.max(16, (viewport.clientHeight - rect.height) / 2);
        viewport.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      } else {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setActiveId(messageId);
      setHoveredId(messageId);
      setPanelOpen(true);
    },
    [shellRef]
  );

  if (disabled || items.length < 2) return null;

  return (
    <nav
      ref={navRef}
      className={`thread-question-nav ${panelOpen ? "is-open" : ""}`}
      aria-label={t("thread.questionNav")}
      onMouseEnter={() => openPanelForQuestion()}
      onMouseLeave={schedulePanelClose}
    >
      <div className="thread-question-nav-track" onMouseEnter={() => openPanelForQuestion()}>
        {items.map((item, index) => {
          const fallbackTop = items.length === 1 ? 0 : (index / (items.length - 1)) * 100;
          const current = item.id === activeId;
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              className={`thread-question-nav-marker ${selected ? "is-selected" : ""}`}
              style={{ top: `${fallbackTop}%` }}
              aria-label={t("thread.jumpQuestion", { index: item.index, label: item.label })}
              aria-current={current ? "location" : undefined}
              title={item.label}
              onMouseEnter={() => openPanelForQuestion(item.id)}
              onClick={() => jumpToQuestion(item.id)}
              onFocus={() => openPanelForQuestion(item.id)}
            />
          );
        })}
      </div>
      <div className="thread-question-nav-panel" onMouseEnter={cancelPanelClose} onMouseLeave={schedulePanelClose}>
        <div className="thread-question-nav-panel-list" ref={panelListRef}>
          {items.map((item) => {
            const selected = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                className={`thread-question-nav-row ${selected ? "is-selected" : ""}`}
                data-question-nav-row-selected={selected ? "true" : undefined}
                aria-current={item.id === activeId ? "location" : undefined}
                onClick={() => jumpToQuestion(item.id)}
                title={item.label}
              >
                <span className="thread-question-nav-row-text">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
