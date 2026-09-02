import { describe, expect, it } from "vitest";

import { isInternalOrganization, isInternalPortalExperience } from "./portal-experience";

describe("isInternalPortalExperience", () => {
  it("gives brand employees the internal portal experience without changing their global user type", () => {
    expect(isInternalPortalExperience({
      userType: "external_user",
      organizationType: "customer",
      membershipType: "brand_employee"
    })).toBe(true);
  });

  it("keeps ordinary customer members on the external portal experience", () => {
    expect(isInternalPortalExperience({
      userType: "external_user",
      organizationType: "customer",
      membershipType: "customer_member"
    })).toBe(false);
  });

  it("targets announcements only by the active internal organization", () => {
    expect(isInternalOrganization("internal")).toBe(true);
    expect(isInternalOrganization(" Internal ")).toBe(true);
    expect(isInternalOrganization("customer")).toBe(false);
  });
});
