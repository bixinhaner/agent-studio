import type { PublicBrandRecord } from "./types.js";

function normalized(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function emailDomain(email: string | null | undefined): string | undefined {
  const value = normalized(email);
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return value.slice(separator + 1);
}

export function brandEmployeeOrganizationIdForEmail(
  brand: Pick<PublicBrandRecord, "employeeEmailDomains" | "employeeOrganizationId"> | null | undefined,
  email: string | null | undefined
): string | undefined {
  const domain = emailDomain(email);
  if (!brand || !domain) return undefined;
  const allowedDomains = new Set(brand.employeeEmailDomains.map(normalized).filter(Boolean));
  if (!allowedDomains.has(domain)) return undefined;
  return normalized(brand.employeeOrganizationId) || undefined;
}
