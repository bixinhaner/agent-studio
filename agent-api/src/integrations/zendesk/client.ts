import type {
  ZendeskAutoStatus,
  ZendeskCommentPayload,
  ZendeskIntegrationSettings,
  ZendeskTicketContext,
  ZendeskTicketPayload,
  ZendeskValidatedUser
} from "./types.js";

type ZendeskUserEnvelope = {
  user?: {
    id?: number;
    name?: string;
    email?: string;
    role?: string;
  };
};

type ZendeskTicketEnvelope = {
  ticket?: {
    id?: number;
    subject?: string;
    description?: string;
    status?: string;
    priority?: string | null;
    requester_id?: number;
    updated_at?: string;
    tags?: string[];
  };
};

type ZendeskCommentsEnvelope = {
  comments?: Array<{
    id?: number;
    author_id?: number;
    body?: string;
    public?: boolean;
    created_at?: string;
  }>;
};

type ZendeskUpdatedTicketEnvelope = {
  audit?: {
    events?: Array<{
      id?: number;
      type?: string;
    }>;
  };
};

export class ZendeskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown
  ) {
    super(message);
  }
}

function buildAuthHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString("base64")}`;
}

function normalizeTicket(ticket: ZendeskTicketEnvelope["ticket"]): ZendeskTicketPayload {
  return {
    id: Number(ticket?.id || 0),
    subject: String(ticket?.subject || "").trim() || `Ticket #${ticket?.id || ""}`.trim(),
    description: typeof ticket?.description === "string" ? ticket.description : "",
    status: typeof ticket?.status === "string" ? ticket.status : undefined,
    priority: typeof ticket?.priority === "string" ? ticket.priority : null,
    tags: Array.isArray(ticket?.tags) ? ticket.tags.map((item) => String(item || "").trim()).filter(Boolean) : [],
    requesterId: typeof ticket?.requester_id === "number" ? ticket.requester_id : undefined,
    updatedAt: typeof ticket?.updated_at === "string" ? ticket.updated_at : undefined
  };
}

function normalizeComments(comments: ZendeskCommentsEnvelope["comments"]): ZendeskCommentPayload[] {
  return Array.isArray(comments)
    ? comments
        .map((item) => ({
          id: Number(item?.id || 0),
          authorId: typeof item?.author_id === "number" ? item.author_id : undefined,
          body: typeof item?.body === "string" ? item.body : "",
          public: Boolean(item?.public),
          createdAt: typeof item?.created_at === "string" ? item.created_at : undefined
        }))
        .filter((item) => item.id > 0)
        .sort((a, b) => {
          const aTime = Date.parse(a.createdAt || "") || 0;
          const bTime = Date.parse(b.createdAt || "") || 0;
          if (aTime !== bTime) return bTime - aTime;
          return b.id - a.id;
        })
    : [];
}

export class ZendeskClient {
  constructor(private readonly settings: ZendeskIntegrationSettings) {}

  buildTicketUrl(ticketId: string): string {
    return `${this.settings.zendeskBaseUrl}/agent/tickets/${encodeURIComponent(ticketId)}`;
  }

  async getMe(): Promise<ZendeskValidatedUser> {
    const data = await this.request<ZendeskUserEnvelope>("/api/v2/users/me.json");
    const user = data.user;
    return {
      id: Number(user?.id || 0),
      name: String(user?.name || "").trim() || "Zendesk User",
      email: typeof user?.email === "string" ? user.email : undefined,
      role: typeof user?.role === "string" ? user.role : undefined
    };
  }

  async getTicketContext(ticketId: string, maxComments: number): Promise<ZendeskTicketContext> {
    const ticketData = await this.request<ZendeskTicketEnvelope>(`/api/v2/tickets/${encodeURIComponent(ticketId)}.json`);
    const ticket = normalizeTicket(ticketData.ticket);
    const comments = await this.listComments(ticketId, maxComments);
    return {
      ticket,
      comments
    };
  }

  async addTicketComment(input: {
    ticketId: string;
    body: string;
    publicReply: boolean;
    autoStatus: ZendeskAutoStatus;
    updatedAt?: string;
  }): Promise<{ commentId?: number }> {
    const ticket: Record<string, unknown> = {
      comment: {
        body: input.body,
        public: input.publicReply
      }
    };

    if (input.autoStatus !== "unchanged") {
      ticket.status = input.autoStatus;
    }
    if (input.updatedAt) {
      ticket.safe_update = true;
      ticket.updated_stamp = input.updatedAt;
    }

    const data = await this.request<ZendeskUpdatedTicketEnvelope>(
      `/api/v2/tickets/${encodeURIComponent(input.ticketId)}.json`,
      {
        method: "PUT",
        body: JSON.stringify({ ticket })
      }
    );
    const commentEvent = data.audit?.events?.find((item) => item?.type === "Comment");
    return {
      commentId: typeof commentEvent?.id === "number" ? commentEvent.id : undefined
    };
  }

  private async listComments(ticketId: string, maxComments: number): Promise<ZendeskCommentPayload[]> {
    const limit = Math.max(1, Math.min(50, maxComments));
    const cursorPath = `/api/v2/tickets/${encodeURIComponent(ticketId)}/comments.json?sort=-created_at&page[size]=${limit}`;
    try {
      const data = await this.request<ZendeskCommentsEnvelope>(cursorPath);
      return normalizeComments(data.comments).slice(0, limit);
    } catch (error) {
      if (!(error instanceof ZendeskApiError) || error.status < 400 || error.status >= 500) {
        throw error;
      }
      const fallback = await this.request<ZendeskCommentsEnvelope>(
        `/api/v2/tickets/${encodeURIComponent(ticketId)}/comments.json?per_page=${limit}`
      );
      return normalizeComments(fallback.comments).slice(0, limit);
    }
  }

  private async request<T>(resourcePath: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers || {});
    headers.set("Accept", "application/json");
    headers.set("Authorization", buildAuthHeader(this.settings.zendeskEmail, this.settings.zendeskApiToken));
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${this.settings.zendeskBaseUrl}${resourcePath}`, {
      ...init,
      headers
    });

    const text = await res.text();
    const payload = text ? safeJsonParse(text) : {};
    if (!res.ok) {
      const detail =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { description?: unknown }).description === "string"
          ? String((payload as { description: string }).description)
          : `Zendesk API 请求失败(${res.status})`;
      throw new ZendeskApiError(detail, res.status, payload);
    }
    return payload as T;
  }
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return { raw: input };
  }
}
