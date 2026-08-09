export type PortalQueueItemStatus = "queued" | "sending" | "failed";

export type PortalQueueItem = {
  id: string;
  text: string;
  status: PortalQueueItemStatus;
  createdAt: number;
};

export type PortalQueuePauseReason = "interrupted" | "failed" | null;

export type PortalComposerStoredState = {
  version: 1;
  draft: string;
  queue: PortalQueueItem[];
  pausedReason: PortalQueuePauseReason;
  updatedAt: number;
};

type ComposerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const PORTAL_COMPOSER_STORAGE_PREFIX = "agent-studio.portal.composer.v1";
export const PORTAL_COMPOSER_MAX_QUEUE_ITEMS = 20;
export const PORTAL_COMPOSER_MAX_TEXT_CHARS = 20_000;
export const PORTAL_COMPOSER_STATE_TTL_MS = 30 * 24 * 60 * 60_000;

export function emptyPortalComposerStoredState(now = Date.now()): PortalComposerStoredState {
  return {
    version: 1,
    draft: "",
    queue: [],
    pausedReason: null,
    updatedAt: now
  };
}

export function portalComposerStorageKey(userId: string, threadId: string): string {
  return `${PORTAL_COMPOSER_STORAGE_PREFIX}:${encodeURIComponent(userId.trim())}:${encodeURIComponent(threadId.trim())}`;
}

function normalizedText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, PORTAL_COMPOSER_MAX_TEXT_CHARS);
}

function normalizedQueueItem(value: unknown, recoverSending: boolean): PortalQueueItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id.trim().slice(0, 120) : "";
  const text = normalizedText(item.text).trim();
  const createdAt = Number(item.createdAt);
  const rawStatus = item.status;
  const status: PortalQueueItemStatus =
    rawStatus === "failed" ? "failed" : rawStatus === "sending" ? (recoverSending ? "failed" : "sending") : "queued";
  if (!id || !text || !Number.isFinite(createdAt)) return null;
  return {
    id,
    text,
    status,
    createdAt
  };
}

function normalizedStoredState(value: unknown, now: number, recoverSending: boolean): PortalComposerStoredState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (state.version !== 1) return null;
  const updatedAt = Number(state.updatedAt);
  if (!Number.isFinite(updatedAt) || now - updatedAt > PORTAL_COMPOSER_STATE_TTL_MS) return null;
  const queue = Array.isArray(state.queue)
    ? state.queue
        .map((item) => normalizedQueueItem(item, recoverSending))
        .filter((item): item is PortalQueueItem => item !== null)
        .slice(0, PORTAL_COMPOSER_MAX_QUEUE_ITEMS)
    : [];
  const pausedReason: PortalQueuePauseReason =
    state.pausedReason === "interrupted"
      ? "interrupted"
      : state.pausedReason === "failed" || queue.some((item) => item.status === "failed")
        ? "failed"
        : null;
  return {
    version: 1,
    draft: normalizedText(state.draft),
    queue,
    pausedReason,
    updatedAt
  };
}

export function loadPortalComposerStoredState(
  storage: ComposerStorage | undefined,
  userId: string,
  threadId: string,
  now = Date.now(),
  options: { recoverSending?: boolean } = {}
): PortalComposerStoredState {
  if (!storage || !userId.trim() || !threadId.trim()) return emptyPortalComposerStoredState(now);
  const key = portalComposerStorageKey(userId, threadId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return emptyPortalComposerStoredState(now);
    const normalized = normalizedStoredState(JSON.parse(raw), now, options.recoverSending !== false);
    if (normalized) return normalized;
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing or when a browser policy blocks it.
  }
  return emptyPortalComposerStoredState(now);
}

export function savePortalComposerStoredState(
  storage: ComposerStorage | undefined,
  userId: string,
  threadId: string,
  state: PortalComposerStoredState,
  now = Date.now()
): PortalComposerStoredState {
  const normalized =
    normalizedStoredState({ ...state, version: 1, updatedAt: now }, now, false) ?? emptyPortalComposerStoredState(now);
  if (!storage || !userId.trim() || !threadId.trim()) return normalized;
  try {
    storage.setItem(portalComposerStorageKey(userId, threadId), JSON.stringify(normalized));
  } catch {
    // Draft persistence is best effort and must never block typing or sending.
  }
  return normalized;
}

export function createPortalQueueItem(text: string, options?: { id?: string; now?: number }): PortalQueueItem {
  const normalized = normalizedText(text).trim();
  if (!normalized) throw new Error("Queued prompt cannot be empty");
  const now = options?.now ?? Date.now();
  const id = options?.id?.trim() || `queue-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    text: normalized,
    status: "queued",
    createdAt: now
  };
}
