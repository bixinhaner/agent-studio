import hostKitStylesheet from "./host-kit/visualize.css?raw";
import hostKitHtml from "./host-kit/visualize-kit.html?raw";

/**
 * Builds the sandboxed document for an in-chat visualization fragment.
 *
 * The visualize skill writes an HTML fragment and relies on its host for theme
 * tokens, base classes, the CDN allowlist, content-sized frames and the
 * `window.openai` bridge. `host-kit/` mirrors the plugin's own
 * `assets/visualize.css` and `assets/visualize.html` (agentstudio-office
 * visualize 1.0.14) so fragments render the same way here as in the skill's
 * `scripts/render.py` preview. Keep both in sync when the plugin is upgraded.
 */

export type InlineVisualizationTheme = "light" | "dark";

export const INLINE_VISUALIZATION_MESSAGE_SOURCE = "agent-studio-inline-vis";
export const INLINE_VISUALIZATION_WIDGET_STATE_MAX_BYTES = 16 * 1024;

const FRAGMENT_PLACEHOLDER = "<!--__INLINE_VISUALIZATION_FRAGMENT__-->";

const RESOURCE_SOURCES = [
  "blob:",
  "data:",
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
  "https://esm.sh",
  "https://fonts.bunny.net",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://unpkg.com"
].join(" ");

// Mirrors `_FRAME_CSP` in the skill's render.py: static resources only from the
// CDN allowlist, and no network APIs (`connect-src` excludes every origin).
export const INLINE_VISUALIZATION_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${RESOURCE_SOURCES}`,
  `style-src 'unsafe-inline' ${RESOURCE_SOURCES}`,
  `img-src ${RESOURCE_SOURCES}`,
  `font-src ${RESOURCE_SOURCES}`,
  `media-src ${RESOURCE_SOURCES}`,
  "worker-src blob:",
  "connect-src blob: data:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

// The frame sits inside the portal's own message surface, so its canvas stays
// transparent instead of painting the kit's standalone background.
const HOST_OVERRIDES = ":root{background-color:transparent !important}";

export type InlineVisualizationDocumentOptions = {
  channel: string;
  theme: InlineVisualizationTheme;
  locale: string;
  widgetState: unknown;
};

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// JSON embedded in an inline <script> must not be able to close the element.
function scriptJson(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function bridgeScript(options: InlineVisualizationDocumentOptions): string {
  const config = {
    source: INLINE_VISUALIZATION_MESSAGE_SOURCE,
    channel: options.channel,
    theme: options.theme,
    locale: options.locale,
    widgetState: options.widgetState ?? null,
    maxWidgetStateBytes: INLINE_VISUALIZATION_WIDGET_STATE_MAX_BYTES
  };
  return `<script>
(() => {
  const config = ${scriptJson(config)};
  const root = document.documentElement;
  const post = (type, payload) => {
    window.parent.postMessage({ source: config.source, channel: config.channel, type, ...payload }, "*");
  };
  const hasUserActivation = () => navigator.userActivation == null || navigator.userActivation.isActive;
  let requestSequence = 0;
  const pendingRequests = new Map();
  const request = (type, payload) =>
    new Promise((resolve, reject) => {
      const requestId = ++requestSequence;
      pendingRequests.set(requestId, { resolve, reject });
      post(type, { ...payload, requestId });
    });
  const globals = { theme: config.theme, locale: config.locale, displayMode: "inline", widgetState: config.widgetState };
  const applyTheme = (theme) => {
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  };
  applyTheme(config.theme);
  const openai = {
    get theme() { return globals.theme; },
    get locale() { return globals.locale; },
    get displayMode() { return globals.displayMode; },
    get widgetState() { return globals.widgetState; },
    setWidgetState(state) {
      let serialized;
      try {
        serialized = JSON.stringify(state ?? null);
      } catch (error) {
        return Promise.reject(error);
      }
      if (new Blob([serialized]).size > config.maxWidgetStateBytes) {
        return Promise.reject(new Error("Widget state exceeds 16 KiB"));
      }
      globals.widgetState = JSON.parse(serialized);
      post("set_widget_state", { state: globals.widgetState });
      return Promise.resolve();
    },
    sendFollowUpMessage(input) {
      const prompt = typeof input === "string" ? input : input && typeof input.prompt === "string" ? input.prompt : "";
      if (!prompt.trim()) return Promise.reject(new Error("A follow-up prompt is required"));
      if (!hasUserActivation()) return Promise.reject(new Error("A follow-up message requires a user action"));
      const title = input && typeof input.title === "string" ? input.title : "";
      return request("follow_up", { prompt, title });
    },
    openExternal(input) {
      const href = typeof input === "string" ? input : input && input.href;
      if (typeof href !== "string" || !/^https?:/i.test(href)) return;
      post("open_external", { href });
    },
    requestDisplayMode() {
      return Promise.resolve({ mode: "inline" });
    },
    notifyIntrinsicHeight() {},
    callTool() {
      return Promise.reject(new Error("Tool calls are not available in this visualization"));
    }
  };
  Object.defineProperty(window, "openai", { value: openai, configurable: false, writable: false });

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== config.source || data.channel !== config.channel) return;
    if (data.type === "set_globals" && data.globals && typeof data.globals === "object") {
      Object.assign(globals, data.globals);
      applyTheme(globals.theme);
      window.dispatchEvent(new CustomEvent("openai:set_globals", { detail: { globals: data.globals } }));
    } else if (data.type === "response" && pendingRequests.has(data.requestId)) {
      const pending = pendingRequests.get(data.requestId);
      pendingRequests.delete(data.requestId);
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new Error(data.error || "Request failed"));
    }
  });

  // Links cannot leave a sandboxed frame without popups; hand http(s) links to
  // the host, which opens them in a new tab during the same user gesture.
  window.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    const href = anchor.href;
    if (!/^https?:/i.test(href)) return;
    event.preventDefault();
    post("open_external", { href });
  });

  let lastHeight = 0;
  const reportHeight = () => {
    const body = document.body;
    if (!body) return;
    const height = Math.ceil(Math.max(body.getBoundingClientRect().height, body.scrollHeight));
    if (height === lastHeight) return;
    lastHeight = height;
    post("resize", { height });
  };
  const observeSize = () => {
    reportHeight();
    if (typeof ResizeObserver === "function") new ResizeObserver(reportHeight).observe(document.body);
  };
  if (document.body) observeSize();
  else document.addEventListener("DOMContentLoaded", observeSize, { once: true });
  window.addEventListener("load", reportHeight);
  post("ready", {});
})();
</script>`;
}

function isFullDocument(html: string): boolean {
  return /<html[\s>]/i.test(html) || /<!doctype\s/i.test(html);
}

export function buildInlineVisualizationDocument(fragment: string, options: InlineVisualizationDocumentOptions): string {
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(INLINE_VISUALIZATION_CSP)}">`,
    `<style>${hostKitStylesheet}\n${HOST_OVERRIDES}</style>`,
    bridgeScript(options)
  ].join("\n");
  const lang = escapeAttribute(options.locale || "en");
  const themeAttribute = `data-theme="${options.theme}"`;

  // The skill asks for fragments, but older turns may contain whole documents.
  // Inject the host head first so its CSP and bridge apply before any content.
  if (isFullDocument(fragment)) {
    const withKit = /<\/body>/i.test(fragment)
      ? fragment.replace(/<\/body>/i, (match) => `${hostKitHtml.replace(FRAGMENT_PLACEHOLDER, "")}${match}`)
      : `${fragment}${hostKitHtml.replace(FRAGMENT_PLACEHOLDER, "")}`;
    const headPattern = /<head(?:\s[^>]*)?>/i;
    if (headPattern.test(withKit)) return withKit.replace(headPattern, (match) => `${match}\n${head}`);
    const htmlPattern = /<html(?:\s[^>]*)?>/i;
    if (htmlPattern.test(withKit)) return withKit.replace(htmlPattern, (match) => `${match}\n<head>\n${head}\n</head>`);
    return `<!doctype html>\n<head>\n${head}\n</head>\n${withKit}`;
  }

  return `<!doctype html>
<html lang="${lang}" ${themeAttribute}>
<head>
${head}
</head>
<body>
${hostKitHtml.replace(FRAGMENT_PLACEHOLDER, () => fragment)}
</body>
</html>
`;
}
