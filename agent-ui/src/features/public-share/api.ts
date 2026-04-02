import { api, apiBase } from "../../lib/api";
import type { ThreadPublicShareView } from "./types";

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
    credentials: "omit"
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (text && !contentType.toLowerCase().includes("application/json")) {
    throw new Error("公开链接接口返回了 HTML 页面，请检查反向代理是否已将 /public-api/* 转发到后端。");
  }
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `请求失败(${response.status})`;
    throw new Error(detail);
  }
  return (data as { share: ThreadPublicShareView }).share;
}

export function resolveThreadPublicShareUrl(publicPath: string): string {
  if (typeof window === "undefined") {
    return publicPath;
  }
  return new URL(publicPath, window.location.origin).toString();
}
