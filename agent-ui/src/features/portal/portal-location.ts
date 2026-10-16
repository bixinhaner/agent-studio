import { RECENT_WORKSPACE_VIEW } from "./workbench/WorkspaceRail";
import {
  PORTAL_BILLING_SEARCH_PARAM,
  PORTAL_THREAD_SEARCH_PARAM,
  PORTAL_WORKSPACE_FILE_SEARCH_PARAM,
  PORTAL_WORKSPACE_FOLDER_SEARCH_PARAM,
  PORTAL_WORKSPACE_QUERY_SEARCH_PARAM,
  type PortalBillingIntent
} from "./portal-constants";

export function readPortalThreadIdFromLocation(search: string): string {
  const params = new URLSearchParams(search);
  return params.get(PORTAL_THREAD_SEARCH_PARAM)?.trim() || "";
}

export function readPortalWorkspaceLocation(search: string): {
  folderId: string;
  fileId: string;
  query: string;
} {
  const params = new URLSearchParams(search);
  return {
    folderId: params.get(PORTAL_WORKSPACE_FOLDER_SEARCH_PARAM)?.trim() || RECENT_WORKSPACE_VIEW,
    fileId: params.get(PORTAL_WORKSPACE_FILE_SEARCH_PARAM)?.trim() || "",
    query: params.get(PORTAL_WORKSPACE_QUERY_SEARCH_PARAM)?.trim() || ""
  };
}

export function writePortalWorkspaceLocation(
  input: {
    folderId?: string;
    threadId?: string;
    fileId?: string;
    query?: string;
  },
  mode: "push" | "replace" = "replace"
): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("view", "workspace");
  const writeValue = (key: string, value: string | undefined) => {
    if (value?.trim()) params.set(key, value.trim());
    else params.delete(key);
  };
  writeValue(PORTAL_WORKSPACE_FOLDER_SEARCH_PARAM, input.folderId);
  writeValue(PORTAL_THREAD_SEARCH_PARAM, input.threadId);
  writeValue(PORTAL_WORKSPACE_FILE_SEARCH_PARAM, input.fileId);
  writeValue(PORTAL_WORKSPACE_QUERY_SEARCH_PARAM, input.query);
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history[mode === "push" ? "pushState" : "replaceState"](
    window.history.state,
    document.title,
    nextUrl
  );
}

export function readPortalBillingIntentFromLocation(search: string): PortalBillingIntent | null {
  const params = new URLSearchParams(search);
  const value = params.get(PORTAL_BILLING_SEARCH_PARAM)?.trim().toLowerCase();
  return value === "renew" || value === "success" || value === "cancel" ? value : null;
}

export function clearPortalBillingIntentFromLocation(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has(PORTAL_BILLING_SEARCH_PARAM)) return;
  params.delete(PORTAL_BILLING_SEARCH_PARAM);
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, document.title, nextUrl);
}

export function replacePortalThreadIdInLocation(threadId: string): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const normalizedThreadId = threadId.trim();
  if (normalizedThreadId) {
    params.set(PORTAL_THREAD_SEARCH_PARAM, normalizedThreadId);
  } else {
    params.delete(PORTAL_THREAD_SEARCH_PARAM);
  }
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, document.title, nextUrl);
}
