/**
 * A new conversation gets its server id in the browser and is created on the server by the
 * first send (one request saves the thread, the message and starts the answer). Until that
 * send is accepted the thread exists only here, so per-thread requests must either wait for
 * it (attachments) or stay local (title, read marker, skill selection).
 */

export type PendingServerThread = {
  remoteId: string;
  localId: string;
  title?: string;
  folderId?: string;
  localRootId?: string;
};

type ThreadCreator = (thread: PendingServerThread) => Promise<void>;

/** Same shape as server-generated ids: 32 lowercase hex characters. */
export function createPortalServerThreadId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID().replace(/-/g, "");
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class PendingServerThreads {
  private readonly items = new Map<string, PendingServerThread>();
  private readonly creating = new Map<string, Promise<void>>();
  private creator: ThreadCreator | undefined;

  add(thread: PendingServerThread): void {
    this.items.set(thread.remoteId, { ...thread });
  }

  get(remoteId: string | null | undefined): PendingServerThread | undefined {
    const key = String(remoteId || "").trim();
    return key ? this.items.get(key) : undefined;
  }

  findByLocalId(localId: string | null | undefined): PendingServerThread | undefined {
    const key = String(localId || "").trim();
    if (!key) return undefined;
    for (const item of this.items.values()) {
      if (item.localId === key) return item;
    }
    return undefined;
  }

  has(remoteId: string | null | undefined): boolean {
    return Boolean(this.get(remoteId));
  }

  setTitle(remoteId: string, title: string): boolean {
    const item = this.get(remoteId);
    if (!item) return false;
    item.title = title;
    return true;
  }

  setLocalRootId(remoteId: string, localRootId: string | undefined): boolean {
    const item = this.get(remoteId);
    if (!item) return false;
    item.localRootId = localRootId;
    return true;
  }

  /** The server now has the thread (a send was accepted or an explicit create finished). */
  confirm(remoteId: string | null | undefined): void {
    const key = String(remoteId || "").trim();
    if (!key) return;
    this.items.delete(key);
  }

  setCreator(creator: ThreadCreator | undefined): void {
    this.creator = creator;
  }

  /** Creates the thread now, for requests that need it before the first send (uploads). */
  async ensureCreated(remoteId: string | null | undefined): Promise<void> {
    const item = this.get(remoteId);
    if (!item) return;
    const inFlight = this.creating.get(item.remoteId);
    if (inFlight) return inFlight;
    const creator = this.creator;
    if (!creator) throw new Error("Thread creation is not available.");
    const promise = creator(item)
      .then(() => this.confirm(item.remoteId))
      .finally(() => this.creating.delete(item.remoteId));
    this.creating.set(item.remoteId, promise);
    return promise;
  }
}

export const pendingServerThreads = new PendingServerThreads();

/**
 * Whether the chat service accepts single-request sends. Learned from the running-status poll
 * (`send_protocol`), so a browser that loaded during a deploy, or after a rollback, keeps using
 * the separate create/save/session requests the serving release understands.
 */
let singleRequestSend = false;

export const PORTAL_SINGLE_REQUEST_SEND_PROTOCOL = 2;

export function setPortalSendProtocol(protocol: unknown): void {
  singleRequestSend = typeof protocol === "number" && protocol >= PORTAL_SINGLE_REQUEST_SEND_PROTOCOL;
}

export function singleRequestSendSupported(): boolean {
  return singleRequestSend;
}
