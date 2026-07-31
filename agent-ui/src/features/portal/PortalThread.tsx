import {
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { Thread, Composer, ThreadWelcome } from "@assistant-ui/react-ui";
import { useAuiEvent } from "@assistant-ui/store";

const THREAD_BOTTOM_THRESHOLD_PX = 2;
const SCROLLBAR_POINTER_ZONE_PX = 18;
const TOUCH_SCROLL_INTENT_PX = 4;

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

type PortalThreadProps = ComponentProps<typeof Thread>;

/**
 * Keeps the normal "follow the latest answer" behavior while making a user's
 * upward scroll authoritative. The upstream viewport can otherwise retain its
 * initialize-to-bottom state while long historical messages are still laying
 * out, causing later resize notifications to pull the reader back to the end.
 */
export const PortalThread: FC<PortalThreadProps> = (config) => {
  const {
    components: {
      Composer: ComposerComponent = Composer,
      ThreadWelcome: ThreadWelcomeComponent = ThreadWelcome,
      MessagesFooter,
      ...messageComponents
    } = {}
  } = config;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const followBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const scheduledScrollFrameRef = useRef(0);

  const stopFollowingBottom = useCallback(() => {
    followBottomRef.current = false;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    lastScrollTopRef.current = viewport.scrollTop;
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    if (!followBottomRef.current) return;
    if (scheduledScrollFrameRef.current) {
      window.cancelAnimationFrame(scheduledScrollFrameRef.current);
    }
    scheduledScrollFrameRef.current = window.requestAnimationFrame(() => {
      scheduledScrollFrameRef.current = 0;
      if (followBottomRef.current) scrollToBottom("auto");
    });
  }, [scrollToBottom]);

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
      attributes: true,
      characterData: true
    });
    scheduleScrollToBottom();

    return () => {
      if (scheduledScrollFrameRef.current) {
        window.cancelAnimationFrame(scheduledScrollFrameRef.current);
      }
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [scheduleScrollToBottom]);

  useAuiEvent("thread.runStart", () => {
    followBottomRef.current = true;
    scheduleScrollToBottom();
  });

  const handleScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      const viewport = event.currentTarget;
      const scrollTop = viewport.scrollTop;
      if (scrollTop < lastScrollTopRef.current - THREAD_BOTTOM_THRESHOLD_PX) {
        stopFollowingBottom();
      } else if (isThreadViewportAtBottom(viewport)) {
        followBottomRef.current = true;
      }
      lastScrollTopRef.current = scrollTop;
    },
    [stopFollowingBottom]
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

  return (
    <Thread.Root config={config}>
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
          <Thread.ScrollToBottom />
          <ComposerComponent />
        </Thread.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </Thread.Root>
  );
};
