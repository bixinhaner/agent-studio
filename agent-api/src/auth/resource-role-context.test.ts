import { describe, expect, it } from "vitest";

import {
  EXTERNAL_ADMIN_RESOURCE_ROLE,
  EXTERNAL_USER_RESOURCE_ROLE,
  INTERNAL_ADMIN_RESOURCE_ROLE,
  INTERNAL_USER_RESOURCE_ROLE,
  isInternalOrganizationType,
  resolveResourceRoleIds
} from "./resource-role-context.js";

describe("resource-role-context", () => {
  it("keeps internal employees on internal resource roles plus legacy employee", () => {
    expect(
      resolveResourceRoleIds({
        platformRole: "employee",
        organizationType: "internal",
        membershipType: "employee"
      })
    ).toEqual([INTERNAL_USER_RESOURCE_ROLE, "employee"]);
  });

  it("adds the internal admin context role for internal admins", () => {
    expect(
      resolveResourceRoleIds({
        platformRole: "admin",
        organizationType: "internal",
        membershipType: "employee"
      })
    ).toEqual([INTERNAL_USER_RESOURCE_ROLE, INTERNAL_ADMIN_RESOURCE_ROLE, "admin"]);
  });

  it("maps external customer members to external user only", () => {
    expect(
      resolveResourceRoleIds({
        platformRole: "employee",
        organizationType: "customer",
        membershipType: "customer_member"
      })
    ).toEqual([EXTERNAL_USER_RESOURCE_ROLE]);
  });

  it("maps external customer admins to external admin and user roles", () => {
    expect(
      resolveResourceRoleIds({
        platformRole: "employee",
        organizationType: "customer",
        membershipType: "customer_admin"
      })
    ).toEqual([EXTERNAL_USER_RESOURCE_ROLE, EXTERNAL_ADMIN_RESOURCE_ROLE]);
  });

  it("falls back to legacy roles only when organization context is unavailable", () => {
    expect(
      resolveResourceRoleIds({
        platformRole: "employee"
      })
    ).toEqual(["employee"]);
  });

  it("only enables department scoping for internal organizations", () => {
    expect(isInternalOrganizationType("internal")).toBe(true);
    expect(isInternalOrganizationType("customer")).toBe(false);
    expect(isInternalOrganizationType(undefined)).toBe(false);
  });
});
