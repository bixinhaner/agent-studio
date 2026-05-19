export type ThreadDeleteMode = "archive" | "hard";

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function isTruthyDeleteFlag(value: unknown): boolean {
  const normalized = firstQueryValue(value);
  if (typeof normalized === "boolean") return normalized;
  if (typeof normalized === "number") return normalized === 1;
  if (typeof normalized !== "string") return false;
  return ["1", "true", "yes", "hard", "permanent"].includes(normalized.trim().toLowerCase());
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return role === "super_admin";
}

export function isHardThreadDeleteRequested(query: Record<string, unknown>): boolean {
  return isTruthyDeleteFlag(query.hard) || isTruthyDeleteFlag(query.permanent);
}

export function resolveThreadDeleteMode(input: {
  query: Record<string, unknown>;
  role?: string | null;
}): { mode: ThreadDeleteMode } | { mode: "forbidden"; detail: string } {
  if (!isHardThreadDeleteRequested(input.query)) {
    return { mode: "archive" };
  }

  if (!isSuperAdminRole(input.role)) {
    return { mode: "forbidden", detail: "Only super admins can permanently delete threads" };
  }

  return { mode: "hard" };
}
