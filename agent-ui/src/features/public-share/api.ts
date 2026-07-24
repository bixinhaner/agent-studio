import { api, apiBase } from "../../lib/api";
import type { ThreadPublicShareStatus, ThreadPublicShareView } from "./types";

export class PublicShareAccessError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "PublicShareAccessError";
  }
}

export async function createThreadPublicShare(
  threadId: string,
  selectedTurnIds: string[]
): Promise<ThreadPublicShareView> {
  const response = await api<{ share: ThreadPublicShareView }>(`/api/threads/${encodeURIComponent(threadId)}/public-share`, {
    method: "POST",
    json: {
      selected_turn_ids: selectedTurnIds
    }
  });
  return response.share;
}

export async function fetchPublicThreadShare(token: string): Promise<ThreadPublicShareView> {
  const response = await fetch(`${apiBase()}/public-api/thread-shares/${encodeURIComponent(token)}`, {
    method: "GET",
    credentials: "include"
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (text && !contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      "The public link API returned an HTML page. Check whether your reverse proxy forwards /public-api/* to the backend."
    );
  }
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `Request failed (${response.status})`;
    throw new PublicShareAccessError(detail, response.status);
  }
  return (data as { share: ThreadPublicShareView }).share;
}

export async function fetchThreadPublicShareStatus(threadId: string): Promise<ThreadPublicShareStatus | null> {
  const response = await api<{ share: ThreadPublicShareStatus | null }>(
    `/api/threads/${encodeURIComponent(threadId)}/public-share`
  );
  return response.share;
}

export async function revokeThreadPublicShare(threadId: string): Promise<boolean> {
  const response = await api<{ revoked: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/public-share`, {
    method: "DELETE"
  });
  return response.revoked;
}

export function resolveThreadPublicShareUrl(publicPath: string): string {
  if (typeof window === "undefined") {
    return publicPath;
  }
  return new URL(publicPath, window.location.origin).toString();
}
