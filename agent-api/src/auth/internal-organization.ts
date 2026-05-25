import type { OrganizationRepository } from "../persistence/organization-repository.js";

export const INTERNAL_ORGANIZATION_ID = "org_internal";
export const INTERNAL_ORGANIZATION_SLUG = "internal";
export const INTERNAL_ORGANIZATION_NAME = "Internal Organization";
export const INTERNAL_ORGANIZATION_TYPE = "internal";
export const INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE = "employee";

export async function ensureInternalOrganization(
  organizations: Pick<OrganizationRepository, "getById" | "getBySlug" | "create">
) {
  const existingById = await organizations.getById(INTERNAL_ORGANIZATION_ID);
  if (existingById) return existingById;

  const existingBySlug = await organizations.getBySlug(INTERNAL_ORGANIZATION_SLUG);
  if (existingBySlug) return existingBySlug;

  return organizations.create({
    slug: INTERNAL_ORGANIZATION_SLUG,
    name: INTERNAL_ORGANIZATION_NAME,
    type: INTERNAL_ORGANIZATION_TYPE,
    status: "active"
  });
}
