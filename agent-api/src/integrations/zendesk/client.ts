import type {
  ZendeskAutoStatus,
  ZendeskAttachmentPayload,
  ZendeskCommentPayload,
  ZendeskIntegrationSettings,
  ZendeskRequesterPayload,
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
    organization_id?: number | null;
    locale?: string;
    time_zone?: string;
    user_fields?: Record<string, unknown> | null;
  };
};

type ZendeskOrganizationEnvelope = {
  organization?: {
    id?: number;
    name?: string;
    organization_fields?: Record<string, unknown> | null;
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
    attachments?: Array<{
      id?: number;
      file_name?: string;
      content_type?: string;
      size?: number;
      content_url?: string;
      mapped_content_url?: string;
      inline?: boolean;
    }>;
  }>;
};

type ZendeskRawComment = NonNullable<ZendeskCommentsEnvelope["comments"]>[number];

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

function trimString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function firstFieldValue(fields: Record<string, unknown> | null | undefined, keys: string[]): string | undefined {
  if (!fields) return undefined;
  const normalized = new Map(
    Object.entries(fields).map(([key, value]) => [
      key
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ""),
      value
    ])
  );
  for (const key of keys) {
    const value = normalized.get(key.toLowerCase().replace(/[^a-z0-9]+/g, ""));
    const text = trimString(value);
    if (text) return text;
  }
  return undefined;
}

function requesterCountryRegion(input: {
  userFields?: Record<string, unknown> | null;
  organizationFields?: Record<string, unknown> | null;
}): string | undefined {
  const keys = [
    "country_region",
    "countryregion",
    "country",
    "region",
    "market",
    "geo",
    "location",
    "requester_country_region"
  ];
  const userValue = firstFieldValue(input.userFields, keys);
  if (userValue) return userValue;
  return firstFieldValue(input.organizationFields, keys);
}

function requesterOrganizationName(input: {
  userFields?: Record<string, unknown> | null;
  organization?: ZendeskOrganizationEnvelope["organization"];
}): string | undefined {
  return (
    trimString(input.organization?.name) ||
    firstFieldValue(input.userFields, [
      "organization",
      "organisation",
      "company",
      "company_name",
      "account",
      "customer",
      "customer_name"
    ])
  );
}

function normalizeZendeskUser(
  user: ZendeskUserEnvelope["user"],
  organization?: ZendeskOrganizationEnvelope["organization"]
): ZendeskRequesterPayload | undefined {
  const id = Number(user?.id || 0);
  if (!Number.isFinite(id) || id <= 0) return undefined;
  const organizationId = Number(user?.organization_id || organization?.id || 0);
  return {
    id,
    name: typeof user?.name === "string" ? user.name.trim() || undefined : undefined,
    email: typeof user?.email === "string" ? user.email.trim() || undefined : undefined,
    role: typeof user?.role === "string" ? user.role.trim() || undefined : undefined,
    organizationId: Number.isFinite(organizationId) && organizationId > 0 ? organizationId : undefined,
    organizationName: requesterOrganizationName({ userFields: user?.user_fields, organization }),
    countryRegion: requesterCountryRegion({
      userFields: user?.user_fields,
      organizationFields: organization?.organization_fields
    })
  };
}

function normalizeAttachmentUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeAttachmentFileName(item: {
  file_name?: string;
  content_url?: string;
  mapped_content_url?: string;
}): string {
  const direct = String(item.file_name || "").trim();
  if (direct) return direct;
  const url = normalizeAttachmentUrl(item.content_url) || normalizeAttachmentUrl(item.mapped_content_url);
  if (url) {
    try {
      const parsed = new URL(url);
      const last = parsed.pathname.split("/").filter(Boolean).pop();
      if (last) return decodeURIComponent(last).trim() || "attachment";
    } catch {
      // fall through
    }
  }
  return "attachment";
}

function normalizeAttachments(value: ZendeskRawComment["attachments"]): ZendeskAttachmentPayload[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const contentUrl = normalizeAttachmentUrl(item?.content_url);
      const mappedContentUrl = normalizeAttachmentUrl(item?.mapped_content_url);
      const size = Number(item?.size);
      return {
        id: typeof item?.id === "number" ? item.id : undefined,
        fileName: normalizeAttachmentFileName(item || {}),
        contentType: typeof item?.content_type === "string" ? item.content_type.trim().toLowerCase() : undefined,
        size: Number.isFinite(size) && size >= 0 ? size : undefined,
        contentUrl,
        mappedContentUrl,
        inline: Boolean(item?.inline)
      };
    })
    .filter((item) => item.contentUrl || item.mappedContentUrl);
}

function normalizeComments(comments: ZendeskCommentsEnvelope["comments"]): ZendeskCommentPayload[] {
  return Array.isArray(comments)
    ? comments
        .map((item) => ({
          id: Number(item?.id || 0),
          authorId: typeof item?.author_id === "number" ? item.author_id : undefined,
          body: typeof item?.body === "string" ? item.body : "",
          public: Boolean(item?.public),
          createdAt: typeof item?.created_at === "string" ? item.created_at : undefined,
          attachments: normalizeAttachments(item?.attachments)
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
    const user = normalizeZendeskUser(data.user);
    return {
      id: Number(user?.id || 0),
      name: user?.name || "Zendesk User",
      email: user?.email,
      role: user?.role
    };
  }

  async getUser(userId: number): Promise<ZendeskRequesterPayload | undefined> {
    if (!Number.isFinite(userId) || userId <= 0) return undefined;
    const data = await this.request<ZendeskUserEnvelope>(`/api/v2/users/${encodeURIComponent(String(userId))}.json`);
    const organizationId = Number(data.user?.organization_id || 0);
    const organization =
      Number.isFinite(organizationId) && organizationId > 0
        ? await this.getOrganization(organizationId).catch(() => undefined)
        : undefined;
    return normalizeZendeskUser(data.user, organization);
  }

  async getOrganization(organizationId: number): Promise<ZendeskOrganizationEnvelope["organization"] | undefined> {
    if (!Number.isFinite(organizationId) || organizationId <= 0) return undefined;
    const data = await this.request<ZendeskOrganizationEnvelope>(
      `/api/v2/organizations/${encodeURIComponent(String(organizationId))}.json`
    );
    return data.organization;
  }

  async getTicketContext(ticketId: string, maxComments: number): Promise<ZendeskTicketContext> {
    const ticketData = await this.request<ZendeskTicketEnvelope>(`/api/v2/tickets/${encodeURIComponent(ticketId)}.json`);
    const ticket = normalizeTicket(ticketData.ticket);
    const [comments, requester] = await Promise.all([
      this.listComments(ticketId, maxComments),
      ticket.requesterId
        ? this.getUser(ticket.requesterId).catch(() => undefined)
        : Promise.resolve(undefined)
    ]);
    return {
      ticket: requester ? { ...ticket, requester } : ticket,
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

  async downloadAttachment(input: {
    url: string;
    maxBytes: number;
  }): Promise<{ content: Buffer; contentType?: string }> {
    const headers = new Headers();
    headers.set("Accept", "*/*");
    headers.set("Authorization", buildAuthHeader(this.settings.zendeskEmail, this.settings.zendeskApiToken));

    const parsed = new URL(input.url);
    if (parsed.protocol !== "https:") {
      throw new Error("附件地址必须是 HTTPS");
    }

    const res = await fetch(parsed.toString(), { headers });
    if (!res.ok) {
      throw new ZendeskApiError(`Zendesk 附件下载失败(${res.status})`, res.status);
    }

    const contentLength = Number(res.headers.get("content-length") || "");
    if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
      throw new Error("附件超过大小限制");
    }

    const content = await readResponseBody(res, input.maxBytes);
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || undefined;
    return { content, contentType };
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

async function readResponseBody(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) {
    const content = Buffer.from(await res.arrayBuffer());
    if (content.byteLength > maxBytes) {
      throw new Error("附件超过大小限制");
    }
    return content;
  }

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    received += chunk.byteLength;
    if (received > maxBytes) {
      throw new Error("附件超过大小限制");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return { raw: input };
  }
}
