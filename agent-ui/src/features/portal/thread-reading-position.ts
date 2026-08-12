export type ThreadReadingPosition = {
  messageId: string;
  offset: number;
  atBottom: boolean;
  updatedAt: number;
};

type ReadingPositionStore = {
  version: 1;
  positions: Record<string, ThreadReadingPosition>;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const THREAD_READING_POSITION_STORAGE_KEY = "agent-studio.portal.thread-reading-position.v1";
const MAX_STORED_THREAD_POSITIONS = 100;
const MAX_READING_POSITION_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const RETURN_TO_LATEST_SMOOTH_VIEWPORTS = 1.5;

export type ThreadScrollFollowMode = "following" | "reading-history";

export function resolveThreadScrollFollowMode(input: {
  current: ThreadScrollFollowMode;
  event: "user-send" | "passive-content" | "user-scroll-up" | "viewport-at-bottom";
}): ThreadScrollFollowMode {
  switch (input.event) {
    case "user-send":
    case "viewport-at-bottom":
      return "following";
    case "user-scroll-up":
      return "reading-history";
    case "passive-content":
      return input.current;
  }
}

function emptyStore(): ReadingPositionStore {
  return { version: 1, positions: {} };
}

function normalizePosition(value: unknown): ThreadReadingPosition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ThreadReadingPosition>;
  if (
    typeof candidate.messageId !== "string" ||
    typeof candidate.offset !== "number" ||
    !Number.isFinite(candidate.offset) ||
    typeof candidate.atBottom !== "boolean" ||
    typeof candidate.updatedAt !== "number" ||
    !Number.isFinite(candidate.updatedAt)
  ) {
    return null;
  }
  return {
    messageId: candidate.messageId.trim(),
    offset: candidate.offset,
    atBottom: candidate.atBottom,
    updatedAt: candidate.updatedAt
  };
}

function readStore(storage: StorageLike): ReadingPositionStore {
  try {
    const raw = storage.getItem(THREAD_READING_POSITION_STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<ReadingPositionStore>;
    if (parsed.version !== 1 || !parsed.positions || typeof parsed.positions !== "object") {
      return emptyStore();
    }
    const positions: Record<string, ThreadReadingPosition> = {};
    for (const [key, value] of Object.entries(parsed.positions)) {
      const normalized = normalizePosition(value);
      if (key && normalized) positions[key] = normalized;
    }
    return { version: 1, positions };
  } catch {
    return emptyStore();
  }
}

export function readThreadReadingPosition(
  storage: StorageLike | null,
  key: string,
  now = Date.now()
): ThreadReadingPosition | null {
  const normalizedKey = key.trim();
  if (!storage || !normalizedKey) return null;
  const position = readStore(storage).positions[normalizedKey];
  if (!position || now - position.updatedAt > MAX_READING_POSITION_AGE_MS) return null;
  return position;
}

export function writeThreadReadingPosition(
  storage: StorageLike | null,
  key: string,
  position: Omit<ThreadReadingPosition, "updatedAt">,
  now = Date.now()
): void {
  const normalizedKey = key.trim();
  if (!storage || !normalizedKey) return;
  try {
    const current = readStore(storage);
    const nextEntries = Object.entries({
      ...current.positions,
      [normalizedKey]: {
        messageId: position.messageId.trim(),
        offset: Number.isFinite(position.offset) ? position.offset : 0,
        atBottom: position.atBottom,
        updatedAt: now
      }
    })
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_STORED_THREAD_POSITIONS);
    storage.setItem(
      THREAD_READING_POSITION_STORAGE_KEY,
      JSON.stringify({ version: 1, positions: Object.fromEntries(nextEntries) } satisfies ReadingPositionStore)
    );
  } catch {
    // Storage can be unavailable in private browsing or restricted embeds.
  }
}

export function resolveReturnToLatestBehavior(input: {
  distance: number;
  viewportHeight: number;
  prefersReducedMotion: boolean;
}): ScrollBehavior {
  if (input.prefersReducedMotion) return "instant";
  const viewportHeight = Math.max(1, input.viewportHeight);
  return input.distance <= viewportHeight * RETURN_TO_LATEST_SMOOTH_VIEWPORTS ? "smooth" : "instant";
}
