import { v4 as uuidv4 } from "uuid";

export type SessionState = {
  sessionId: string;
  threadId?: string;
  thread: any;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly ttlMs: number) {}

  create(payload: Omit<SessionState, "sessionId" | "createdAt" | "updatedAt">): SessionState {
    const now = new Date().toISOString();
    const session: SessionState = {
      sessionId: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...payload
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): SessionState | undefined {
    const item = this.sessions.get(sessionId);
    if (!item) return undefined;
    const last = new Date(item.updatedAt).getTime();
    if (Number.isFinite(last) && Date.now() - last > this.ttlMs) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    item.updatedAt = new Date().toISOString();
    return item;
  }

  peek(sessionId: string): SessionState | undefined {
    const item = this.sessions.get(sessionId);
    if (!item) return undefined;
    const last = new Date(item.updatedAt).getTime();
    if (Number.isFinite(last) && Date.now() - last > this.ttlMs) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return item;
  }

  update(
    sessionId: string,
    patch: Partial<Pick<SessionState, "model" | "reasoningEffort" | "workspace" | "codexRunConfig">>
  ): SessionState {
    const item = this.sessions.get(sessionId);
    if (!item) {
      throw new Error("session 不存在");
    }
    if (patch.model) item.model = patch.model;
    if (patch.reasoningEffort) item.reasoningEffort = patch.reasoningEffort;
    if (patch.workspace) item.workspace = patch.workspace;
    if (patch.codexRunConfig) item.codexRunConfig = patch.codexRunConfig;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  cleanupExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      const last = new Date(session.updatedAt).getTime();
      if (Number.isFinite(last) && now - last > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }
}
