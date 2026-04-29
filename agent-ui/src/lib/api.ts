export type ApiInit = RequestInit & { json?: unknown };
export const AUTH_INVALID_EVENT = "agent-auth-invalid";

export function notifyAuthInvalidStatus(status: number) {
  if (typeof window !== "undefined" && status === 401) {
    window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: { status } }));
  }
}

export function apiBase() {
  const configured = (import.meta.env.VITE_AGENT_API_BASE || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (import.meta.env.DEV) return "http://127.0.0.1:8787";
  return "";
}

export function authHeaders(): Record<string, string> {
  const token = (import.meta.env.VITE_AGENT_API_TOKEN || "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  headers.set("Content-Type", "application/json");
  for (const [k, v] of Object.entries(authHeaders())) {
    headers.set(k, v);
  }

  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    credentials: init?.credentials ?? "include",
    headers,
    body: init?.json === undefined ? init?.body : JSON.stringify(init.json)
  });

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const snippet = text.replace(/\s+/g, " ").trim().slice(0, 120);
      const suffix = snippet ? `: ${snippet}` : "";
      throw new Error(`API returned a non-JSON response (${res.status})${suffix}`);
    }
  }
  if (!res.ok) {
    notifyAuthInvalidStatus(res.status);
    const detail = data && typeof data === "object" && "detail" in data ? (data as { detail?: unknown }).detail : undefined;
    const msg = (typeof detail === "string" && detail) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}
