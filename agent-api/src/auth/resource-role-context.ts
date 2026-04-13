function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => trimOrUndefined(value)).filter((value): value is string => Boolean(value)))];
}

export const INTERNAL_USER_RESOURCE_ROLE = "org_internal_user";
export const INTERNAL_ADMIN_RESOURCE_ROLE = "org_internal_admin";
export const EXTERNAL_USER_RESOURCE_ROLE = "org_external_user";
export const EXTERNAL_ADMIN_RESOURCE_ROLE = "org_external_admin";

export function isInternalOrganizationType(organizationType: string | null | undefined): boolean {
  return trimOrUndefined(organizationType) === "internal";
}

export function resolveResourceRoleIds(input: {
  platformRole?: string | null;
  organizationType?: string | null;
  membershipType?: string | null;
}): string[] {
  const platformRole = trimOrUndefined(input.platformRole);
  const organizationType = trimOrUndefined(input.organizationType);
  const membershipType = trimOrUndefined(input.membershipType);

  if (!organizationType) {
    return uniqueStrings([platformRole ?? "employee"]);
  }

  if (organizationType === "internal") {
    return uniqueStrings([
      INTERNAL_USER_RESOURCE_ROLE,
      platformRole === "admin" || platformRole === "super_admin" ? INTERNAL_ADMIN_RESOURCE_ROLE : undefined,
      platformRole ?? "employee"
    ]);
  }

  return uniqueStrings([
    EXTERNAL_USER_RESOURCE_ROLE,
    membershipType === "customer_admin" ? EXTERNAL_ADMIN_RESOURCE_ROLE : undefined
  ]);
}
