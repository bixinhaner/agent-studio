import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { Thread, Composer, ThreadWelcome } from "@assistant-ui/react-ui";
import { useAuiEvent } from "@assistant-ui/store";
import { ArrowDownIcon } from "lucide-react";

import {
  readThreadReadingPosition,
  resolveReturnToLatestBehavior,
  resolveThreadScrollFollowMode,
  type ThreadScrollFollowMode,
  writeThreadReadingPosition
} from "./thread-reading-position";

const THREAD_BOTTOM_THRESHOLD_PX = 2;
const SCROLLBAR_POINTER_ZONE_PX = 18;
const TOUCH_SCROLL_INTENT_PX = 4;
const READING_POSITION_SAVE_DELAY_MS = 180;
const POSITIONING_PLACEHOLDER_DELAY_MS = 80;
const INITIAL_POSITION_MAX_WAIT_MS = 280;
const INITIAL_POSITION_STABLE_FRAMES = 2;

export function isThreadViewportAtBottom(element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= THREAD_BOTTOM_THRESHOLD_PX;
}

export function isThreadScrollbarPointer(
  elementRight: number,
  clientX: number,
  pointerType: string
) {
  return pointerType === "mouse" && clientX >= elementRight - SCROLLBAR_POINTER_ZONE_PX;
}

type PortalThreadProps = ComponentProps<typeof Thread> & {
  readingPositionKey?: string;
  positioningLabel?: string;
  scrollToBottomLabel?: string;
};

const PortalThreadUserSendIntentContext = createContext<() => void>(() => undefined);

export function usePortalThreadUserSendIntent(): () => void {
  return useContext(PortalThreadUserSendIntentContext);
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function threadMessageElements(viewport: HTMLElement): HTMLElement[] {
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]"));
}

const AdaptiveScrollToBottom: FC<{
  atBottom: boolean;
  label: string;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  onScrollToBottom: (behavior: ScrollBehavior) => void;
}> = ({ atBottom, label, viewportRef, onScrollToBottom }) => {
  if (atBottom) return null;

  return (
    <button
      type="button"
      className="aui-button aui-button-outline aui-thread-scroll-to-bottom portal-return-to-latest"
      title={label}
      aria-label={label}
      onClick={() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const distance = Math.max(0, viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight);
        const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        onScrollToBottom(resolveReturnToLatestBehavior({
          distance,
          viewportHeight: viewport.clientHeight,
          prefersReducedMotion
        }));
      }}
    >
      <ArrowDownIcon size={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
};

/**
 * Keeps the normal "follow the latest answer" behavior while making a user's
 * upward scroll authoritative. The upstream viewport can otherwise retain its
 * initialize-to-bottom state while long historical messages are still laying
 * out, causing later resize notifications to pull the reader back to the end.
 */
export const PortalThread: FC<PortalThreadProps> = (config) => {
  const {
    readingPositionKey = "",
    positioningLabel = "Restoring your reading position…",
    scrollToBottomLabel = "Scroll to bottom",
    ...threadConfig
  } = config;
  const {
    components: {
      Composer: ComposerComponent = Composer,
      ThreadWelcome: ThreadWelcomeComponent = ThreadWelcome,
      MessagesFooter,
      ...messageComponents
    } = {}
  } = threadConfig;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const followModeRef = useRef<ThreadScrollFollowMode>("reading-history");
  const lastScrollTopRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const scheduledScrollFrameRef = useRef(0);
  const savePositionTimerRef = useRef(0);
  const positioningRef = useRef(true);
  const [positioning, setPositioning] = useState(true);
  const [showPositioningPlaceholder, setShowPositioningPlaceholder] = useState(false);
  const [viewportAtBottom, setViewportAtBottom] = useState(true);

  const persistReadingPosition = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || positioningRef.current || !readingPositionKey) return;
    const messages = threadMessageElements(viewport);
    const viewportRect = viewport.getBoundingClientRect();
    const anchor = messages.find((message) => message.getBoundingClientRect().bottom > viewportRect.top + 1)
      ?? messages.at(-1);
    writeThreadReadingPosition(browserStorage(), readingPositionKey, {
      messageId: anchor?.dataset.messageId || "",
      offset: anchor ? anchor.getBoundingClientRect().top - viewportRect.top : 0,
      atBottom: isThreadViewportAtBottom(viewport)
    });
  }, [readingPositionKey]);

  const scheduleReadingPositionSave = useCallback(() => {
    if (positioningRef.current) return;
    if (savePositionTimerRef.current) window.clearTimeout(savePositionTimerRef.current);
    savePositionTimerRef.current = window.setTimeout(() => {
      savePositionTimerRef.current = 0;
      persistReadingPosition();
    }, READING_POSITION_SAVE_DELAY_MS);
  }, [persistReadingPosition]);

  const stopFollowingBottom = useCallback(() => {
    followModeRef.current = resolveThreadScrollFollowMode({
      current: followModeRef.current,
      event: "user-scroll-up"
    });
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    lastScrollTopRef.current = viewport.scrollTop;
    setViewportAtBottom(true);
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    if (positioningRef.current || followModeRef.current !== "following") return;
    if (scheduledScrollFrameRef.current) {
      window.cancelAnimationFrame(scheduledScrollFrameRef.current);
    }
    scheduledScrollFrameRef.current = window.requestAnimationFrame(() => {
      scheduledScrollFrameRef.current = 0;
      if (!positioningRef.current && followModeRef.current === "following") scrollToBottom("instant");
    });
  }, [scrollToBottom]);

  const followLatestAfterUserSend = useCallback(() => {
    followModeRef.current = resolveThreadScrollFollowMode({
      current: followModeRef.current,
      event: "user-send"
    });
    setViewportAtBottom(true);
    if (savePositionTimerRef.current) {
      window.clearTimeout(savePositionTimerRef.current);
      savePositionTimerRef.current = 0;
    }
    const viewport = viewportRef.current;
    if (viewport && readingPositionKey) {
      writeThreadReadingPosition(browserStorage(), readingPositionKey, {
        messageId: threadMessageElements(viewport).at(-1)?.dataset.messageId || "",
        offset: 0,
        atBottom: true
      });
    }
    if (positioningRef.current) return;
    scrollToBottom("instant");
    scheduleScrollToBottom();
  }, [readingPositionKey, scheduleScrollToBottom, scrollToBottom]);

  useLayoutEffect(() => {
    positioningRef.current = true;
    followModeRef.current = "reading-history";
    setPositioning(true);
    const savedPosition = readThreadReadingPosition(browserStorage(), readingPositionKey);
    let frame = 0;
    let stableFrames = 0;
    let previousSignature = "";
    let settled = false;
    let placeholderTimer = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(placeholderTimer);
      const viewport = viewportRef.current;
      if (viewport) {
        lastScrollTopRef.current = viewport.scrollTop;
        setViewportAtBottom(isThreadViewportAtBottom(viewport));
      }
      positioningRef.current = false;
      setPositioning(false);
      setShowPositioningPlaceholder(false);
    };

    const positionViewport = (force = false) => {
      const viewport = viewportRef.current;
      if (!viewport) return false;
      const messages = threadMessageElements(viewport);
      const welcomeReady = Boolean(viewport.querySelector(".aui-thread-welcome-root, .bailey-welcome-container"));
      if (!force && messages.length === 0 && !welcomeReady) return false;

      if (savedPosition && !savedPosition.atBottom && savedPosition.messageId) {
        const anchor = messages.find((message) => message.dataset.messageId === savedPosition.messageId);
        if (!anchor && !force) return false;
        if (anchor) {
          const viewportTop = viewport.getBoundingClientRect().top;
          viewport.scrollTop += anchor.getBoundingClientRect().top - viewportTop - savedPosition.offset;
          followModeRef.current = "reading-history";
        } else {
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
          followModeRef.current = "following";
        }
      } else {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
        followModeRef.current = "following";
      }

      const signature = `${viewport.scrollHeight}:${viewport.clientHeight}:${messages.length}`;
      stableFrames = signature === previousSignature ? stableFrames + 1 : 0;
      previousSignature = signature;
      if (force || stableFrames >= INITIAL_POSITION_STABLE_FRAMES) finish();
      return true;
    };

    const settle = () => {
      if (settled) return;
      positionViewport(false);
      if (!settled) frame = window.requestAnimationFrame(settle);
    };
    setShowPositioningPlaceholder(false);
    placeholderTimer = window.setTimeout(() => {
      if (!settled) setShowPositioningPlaceholder(true);
    }, POSITIONING_PLACEHOLDER_DELAY_MS);
    frame = window.requestAnimationFrame(settle);
    const fallbackTimer = window.setTimeout(() => {
      positionViewport(true);
      finish();
    }, INITIAL_POSITION_MAX_WAIT_MS);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(placeholderTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, [readingPositionKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const resizeObserver = new ResizeObserver(scheduleScrollToBottom);
    const mutationObserver = new MutationObserver((mutations) => {
      const hasContentChange = mutations.some(
        (mutation) => mutation.type !== "attributes" || mutation.attributeName !== "style"
      );
      if (hasContentChange) scheduleScrollToBottom();
    });

    resizeObserver.observe(viewport);
    mutationObserver.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return () => {
      if (scheduledScrollFrameRef.current) {
        window.cancelAnimationFrame(scheduledScrollFrameRef.current);
      }
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [scheduleScrollToBottom]);

  useAuiEvent("thread.runStart", () => {
    followModeRef.current = resolveThreadScrollFollowMode({
      current: followModeRef.current,
      event: "passive-content"
    });
    if (followModeRef.current === "following") scheduleScrollToBottom();
  });

  const handleScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      const viewport = event.currentTarget;
      const scrollTop = viewport.scrollTop;
      const atBottom = isThreadViewportAtBottom(viewport);
      if (scrollTop < lastScrollTopRef.current - THREAD_BOTTOM_THRESHOLD_PX) {
        stopFollowingBottom();
      } else if (atBottom) {
        followModeRef.current = resolveThreadScrollFollowMode({
          current: followModeRef.current,
          event: "viewport-at-bottom"
        });
      }
      setViewportAtBottom(atBottom);
      lastScrollTopRef.current = scrollTop;
      scheduleReadingPositionSave();
    },
    [scheduleReadingPositionSave, stopFollowingBottom]
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) stopFollowingBottom();
    },
    [stopFollowingBottom]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") {
        touchStartYRef.current = event.clientY;
        return;
      }
      const viewportRight = event.currentTarget.getBoundingClientRect().right;
      if (isThreadScrollbarPointer(viewportRight, event.clientX, event.pointerType)) {
        stopFollowingBottom();
      }
    },
    [stopFollowingBottom]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const touchStartY = touchStartYRef.current;
      if (
        event.pointerType === "touch" &&
        touchStartY !== null &&
        event.clientY > touchStartY + TOUCH_SCROLL_INTENT_PX
      ) {
        stopFollowingBottom();
      }
    },
    [stopFollowingBottom]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
        stopFollowingBottom();
      }
    },
    [stopFollowingBottom]
  );

  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".aui-thread-followup-suggestion")) {
        followLatestAfterUserSend();
      }
    },
    [followLatestAfterUserSend]
  );

  useEffect(() => {
    const persistOnPageHide = () => persistReadingPosition();
    window.addEventListener("pagehide", persistOnPageHide);
    return () => {
      window.removeEventListener("pagehide", persistOnPageHide);
      if (savePositionTimerRef.current) window.clearTimeout(savePositionTimerRef.current);
      persistReadingPosition();
    };
  }, [persistReadingPosition]);

  return (
    <div
      className={`portal-thread-position-shell${positioning ? " is-positioning" : ""}`}
      aria-busy={positioning || undefined}
    >
      <PortalThreadUserSendIntentContext.Provider value={followLatestAfterUserSend}>
        <Thread.Root config={threadConfig} aria-hidden={positioning || undefined}>
          <ThreadPrimitive.Viewport
            ref={viewportRef}
            className="aui-thread-viewport"
            autoScroll={false}
            scrollToBottomOnInitialize={false}
            scrollToBottomOnThreadSwitch={false}
            scrollToBottomOnRunStart={false}
            onScroll={handleScroll}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onClickCapture={handleClickCapture}
            onPointerUp={() => {
              touchStartYRef.current = null;
            }}
            onPointerCancel={() => {
              touchStartYRef.current = null;
            }}
            onKeyDown={handleKeyDown}
          >
            <ThreadWelcomeComponent />
            <Thread.Messages MessagesFooter={MessagesFooter} components={messageComponents} />
            <Thread.FollowupSuggestions />
            <Thread.ViewportFooter>
              <AdaptiveScrollToBottom
                atBottom={viewportAtBottom}
                label={scrollToBottomLabel}
                viewportRef={viewportRef}
                onScrollToBottom={(behavior) => {
                  followModeRef.current = "following";
                  scrollToBottom(behavior);
                }}
              />
              <ComposerComponent />
            </Thread.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </Thread.Root>
      </PortalThreadUserSendIntentContext.Provider>
      {showPositioningPlaceholder ? (
        <div className="portal-thread-position-placeholder" role="status" aria-live="polite">
          <span className="aui-sr-only">{positioningLabel}</span>
          <div className="portal-thread-position-placeholder-content" aria-hidden="true">
            <div className="portal-thread-position-placeholder-avatar" />
            <div className="portal-thread-position-placeholder-copy">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
