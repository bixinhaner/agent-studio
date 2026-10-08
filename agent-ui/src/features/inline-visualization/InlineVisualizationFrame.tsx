import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildInlineVisualizationDocument,
  INLINE_VISUALIZATION_MESSAGE_SOURCE,
  INLINE_VISUALIZATION_WIDGET_STATE_MAX_BYTES,
  type InlineVisualizationTheme
} from "./inline-visualization-document";

export const INLINE_VISUALIZATION_MIN_HEIGHT = 48;
export const INLINE_VISUALIZATION_MAX_HEIGHT = 2400;
export const INLINE_VISUALIZATION_FOLLOW_UP_MAX_CHARS = 8000;
const INITIAL_HEIGHT = 160;
const WIDGET_STATE_STORAGE_PREFIX = "agent-studio.inline-vis.widget-state.v1:";

export type InlineVisualizationFollowUp = { prompt: string; title: string };

type FrameMessage = {
  source: string;
  channel: string;
  type: string;
  [key: string]: unknown;
};

function readDocumentTheme(): InlineVisualizationTheme {
  return document.documentElement.dataset.portalTheme === "dark" ? "dark" : "light";
}

/** Follows the portal theme that `usePortalTheme` writes to the document root. */
export function useInlineVisualizationTheme(): InlineVisualizationTheme {
  const [theme, setTheme] = useState<InlineVisualizationTheme>(readDocumentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readDocumentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-portal-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function readWidgetState(storageKey: string): unknown {
  try {
    const raw = window.localStorage.getItem(WIDGET_STATE_STORAGE_PREFIX + storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeWidgetState(storageKey: string, state: unknown): void {
  try {
    const serialized = JSON.stringify(state ?? null);
    if (new Blob([serialized]).size > INLINE_VISUALIZATION_WIDGET_STATE_MAX_BYTES) return;
    window.localStorage.setItem(WIDGET_STATE_STORAGE_PREFIX + storageKey, serialized);
  } catch {
    // Storage may be full or disabled; the visualization keeps working without persistence.
  }
}

function createChannel(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clampHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(INLINE_VISUALIZATION_MAX_HEIGHT, Math.max(INLINE_VISUALIZATION_MIN_HEIGHT, Math.ceil(value)));
}

function isExternalHref(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function InlineVisualizationFrame(props: {
  fragment: string;
  title: string;
  /** Scopes persisted widget state, e.g. `${threadId}:${filePath}`. */
  storageKey: string;
  theme: InlineVisualizationTheme;
  locale?: string;
  /**
   * Hands a follow-up prompt to the host; it must never be sent without the user.
   * Omit for read-only surfaces such as the admin conversation record.
   */
  onFollowUp?: (followUp: InlineVisualizationFollowUp) => void;
}) {
  const { fragment, title, storageKey, theme, locale, onFollowUp } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const channel = useMemo(createChannel, [fragment, storageKey]);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const onFollowUpRef = useRef(onFollowUp);
  onFollowUpRef.current = onFollowUp;

  // Theme and widget state are read once per document; later changes are pushed
  // through `set_globals` so interacting with the visual never reloads it.
  const srcDoc = useMemo(
    () =>
      buildInlineVisualizationDocument(fragment, {
        channel,
        theme: themeRef.current,
        locale: locale || navigator.language || "en",
        widgetState: readWidgetState(storageKey)
      }),
    [channel, fragment, locale, storageKey]
  );

  useEffect(() => {
    setHeight(INITIAL_HEIGHT);
  }, [srcDoc]);

  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    frameWindow?.postMessage(
      { source: INLINE_VISUALIZATION_MESSAGE_SOURCE, channel, type: "set_globals", globals: { theme } },
      "*"
    );
  }, [channel, theme]);

  useEffect(() => {
    const respond = (requestId: unknown, ok: boolean, error?: string) => {
      iframeRef.current?.contentWindow?.postMessage(
        { source: INLINE_VISUALIZATION_MESSAGE_SOURCE, channel, type: "response", requestId, ok, error },
        "*"
      );
    };
    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const data = event.data as FrameMessage | null;
      if (!data || data.source !== INLINE_VISUALIZATION_MESSAGE_SOURCE || data.channel !== channel) return;

      switch (data.type) {
        case "ready":
          // The frame may have loaded after a theme switch.
          frameWindow.postMessage(
            { source: INLINE_VISUALIZATION_MESSAGE_SOURCE, channel, type: "set_globals", globals: { theme: themeRef.current } },
            "*"
          );
          break;
        case "resize": {
          const next = clampHeight(data.height);
          if (next !== null) setHeight(next);
          break;
        }
        case "set_widget_state":
          writeWidgetState(storageKey, data.state);
          break;
        case "follow_up": {
          const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
          if (!prompt) {
            respond(data.requestId, false, "A follow-up prompt is required");
            break;
          }
          if (prompt.length > INLINE_VISUALIZATION_FOLLOW_UP_MAX_CHARS) {
            respond(data.requestId, false, "The follow-up prompt is too long");
            break;
          }
          const handleFollowUp = onFollowUpRef.current;
          if (!handleFollowUp) {
            respond(data.requestId, false, "Follow-up messages are not available here");
            break;
          }
          const followUpTitle = typeof data.title === "string" ? data.title.trim().slice(0, 250) : "";
          handleFollowUp({ prompt, title: followUpTitle });
          respond(data.requestId, true);
          break;
        }
        case "open_external":
          if (isExternalHref(data.href)) window.open(data.href, "_blank", "noopener,noreferrer");
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channel, storageKey]);

  return (
    <iframe
      ref={iframeRef}
      className="assistant-inline-vis-frame"
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      allow="clipboard-write"
      referrerPolicy="no-referrer"
      style={{ height }}
    />
  );
}
