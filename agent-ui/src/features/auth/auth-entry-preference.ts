import type { AuthMembership, AuthOrganization, AuthSession, AuthUser } from "./api";

export type AuthEntryMode = "external" | "internal";

const AUTH_ENTRY_MODE_KEY = "agent_studio_auth_entry_mode";

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readPreferredAuthEntryMode(): AuthEntryMode | null {
  const value = safeStorage()?.getItem(AUTH_ENTRY_MODE_KEY);
  return value === "internal" || value === "external" ? value : null;
}

export function rememberPreferredAuthEntryMode(mode: AuthEntryMode): void {
  safeStorage()?.setItem(AUTH_ENTRY_MODE_KEY, mode);
}

export function isInternalAuthSession(input: {
  user?: Pick<AuthUser, "userType"> | null;
  activeOrganization?: Pick<AuthOrganization, "type"> | null;
  memberships?: Array<Pick<AuthMembership, "organization">> | null;
}): boolean {
  if (input.user?.userType === "internal_employee") return true;
  if (input.activeOrganization?.type === "internal") return true;
  return Boolean(input.memberships?.some((membership) => membership.organization?.type === "internal"));
}

export function rememberSessionAuthEntryMode(session: AuthSession | null): AuthEntryMode | null {
  if (!session) return null;
  const mode: AuthEntryMode = isInternalAuthSession(session) ? "internal" : "external";
  rememberPreferredAuthEntryMode(mode);
  return mode;
}
