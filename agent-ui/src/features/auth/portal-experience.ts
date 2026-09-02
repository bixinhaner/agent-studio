export const BRAND_EMPLOYEE_MEMBERSHIP_TYPE = "brand_employee";

function normalized(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isBrandEmployeeMembership(membershipType: string | null | undefined): boolean {
  return normalized(membershipType) === BRAND_EMPLOYEE_MEMBERSHIP_TYPE;
}

export function isInternalPortalExperience(input: {
  userType?: string | null;
  organizationType?: string | null;
  membershipType?: string | null;
}): boolean {
  if (isBrandEmployeeMembership(input.membershipType)) return true;
  return normalized(input.userType) !== "external_user" && normalized(input.organizationType) === "internal";
}
