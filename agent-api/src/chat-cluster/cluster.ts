// Blue-green chat runs two chat instances during a switch: the retiring one
// finishes its runs while the new one takes every new request. Each instance
// learns what its peers own from their local-only status endpoint, which the
// pre-blue-green release already serves, so the first switch works too.

export type RunOwnershipKind = "portal_session" | "crest_run" | "action_connector_run";

export type RunKey = { kind: RunOwnershipKind; id: string };

export type OwnedRuns = Record<RunOwnershipKind, string[]>;

export type ChatPeerState =
  /** Connection refused: the slot is stopped, so it owns nothing. */
  | "down"
  /** Timed out or answered unexpectedly: what it owns is unknown. */
  | "unknown"
  | "up";

export type ChatPeerStatus = {
  url: string;
  state: ChatPeerState;
  error?: string;
  /** Missing on releases from before blue-green. */
  instanceId?: string;
  /** Only slot-aware releases report readiness; legacy peers never receive forwarded work. */
  ready: boolean;
  draining: boolean;
  busyCount: number;
  activeThreads: Record<string, unknown>[];
  turns: Record<string, unknown>[];
  ownedRuns?: OwnedRuns;
};

export const CHAT_STATUS_PATH = "/internal/deploy/drain-status";
export const FORWARDED_BY_HEADER = "x-agent-studio-forwarded-by";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "0.0.0.0";
}

/** Drops this instance's own URL so it never queries or forwards to itself. */
export function peerUrlsExcludingSelf(urls: string[], selfPort: number): string[] {
  return urls.filter((url) => {
    try {
      const parsed = new URL(url);
      const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
      return !(isLoopbackHost(parsed.hostname) && port === selfPort);
    } catch {
      return false;
    }
  });
}

function connectionRefused(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === "ECONNREFUSED") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function parseChatPeerStatus(url: string, payload: unknown): ChatPeerStatus {
  const record = asRecord(payload) ?? {};
  const owned = asRecord(record.owned_runs);
  const busyCount = typeof record.busy_count === "number"
    ? record.busy_count
    : typeof record.active_runtime_turns === "number"
      ? record.active_runtime_turns + records(record.active_threads).length
      : 0;
  return {
    url,
    state: "up",
    instanceId: typeof record.instance_id === "string" ? record.instance_id : undefined,
    ready: record.ready === true,
    draining: record.draining === true,
    busyCount,
    activeThreads: records(record.active_threads),
    turns: records(record.turns),
    ownedRuns: owned
      ? {
          portal_session: strings(owned.portal_session),
          crest_run: strings(owned.crest_run),
          action_connector_run: strings(owned.action_connector_run)
        }
      : undefined
  };
}

export async function fetchChatPeerStatus(
  url: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<ChatPeerStatus> {
  const empty = { url, ready: false, draining: false, busyCount: 0, activeThreads: [], turns: [] };
  try {
    const response = await (options.fetchImpl ?? fetch)(`${url}${CHAT_STATUS_PATH}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500)
    });
    if (!response.ok) return { ...empty, state: "unknown", error: `status ${response.status}` };
    return parseChatPeerStatus(url, await response.json());
  } catch (error) {
    if (connectionRefused(error)) return { ...empty, state: "down" };
    return { ...empty, state: "unknown", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Whether a peer currently owns the run; legacy peers only expose portal sessions through their turns. */
export function peerOwnsRun(status: ChatPeerStatus, key: RunKey): boolean {
  if (status.state !== "up") return false;
  if (status.ownedRuns) return status.ownedRuns[key.kind].includes(key.id);
  if (key.kind !== "portal_session") return false;
  return status.turns.some((turn) => turn.session_id === key.id);
}

/** Whether a peer is running a portal response on the thread for this user (sessions are per instance and per tab). */
export function peerRunsPortalThread(status: ChatPeerStatus, threadId: string, userId: string): boolean {
  if (status.state !== "up") return false;
  return status.activeThreads.some(
    (item) => item.thread_id === threadId && item.user_id === userId && item.channel === "portal"
  );
}

export class ChatClusterView {
  private readonly peers: string[];
  private readyCache?: { at: number; peer?: ChatPeerStatus };

  constructor(
    private readonly options: {
      peerUrls: string[];
      selfPort: number;
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
      now?: () => number;
    }
  ) {
    this.peers = peerUrlsExcludingSelf(options.peerUrls, options.selfPort);
  }

  get peerUrls(): string[] {
    return [...this.peers];
  }

  get enabled(): boolean {
    return this.peers.length > 0;
  }

  async statuses(): Promise<ChatPeerStatus[]> {
    return Promise.all(
      this.peers.map((url) => fetchChatPeerStatus(url, { timeoutMs: this.options.timeoutMs, fetchImpl: this.options.fetchImpl }))
    );
  }

  async findOwner(key: RunKey): Promise<ChatPeerStatus | undefined> {
    for (const status of await this.statuses()) {
      if (peerOwnsRun(status, key)) return status;
    }
    return undefined;
  }

  async findPortalThreadOwner(threadId: string, userId: string): Promise<ChatPeerStatus | undefined> {
    for (const status of await this.statuses()) {
      if (peerRunsPortalThread(status, threadId, userId)) return status;
    }
    return undefined;
  }

  /** A slot-aware peer that accepts new work. Cached briefly because retiring instances ask per request. */
  async readyPeer(maxAgeMs = 1000): Promise<ChatPeerStatus | undefined> {
    const now = (this.options.now ?? Date.now)();
    if (this.readyCache && now - this.readyCache.at < maxAgeMs) return this.readyCache.peer;
    const peer = (await this.statuses()).find((status) => status.state === "up" && status.ready && !status.draining);
    this.readyCache = { at: now, peer };
    return peer;
  }
}
