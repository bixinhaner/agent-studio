import { describe, expect, it } from "vitest";

import { canAccessPortalTraining } from "./training-access";

describe("canAccessPortalTraining", () => {
  it("allows internal employees in an internal organization", () => {
    expect(canAccessPortalTraining({
      userType: "internal_employee",
      organizationType: "internal"
    })).toBe(true);
  });

  it("hides training from external users and customer organizations", () => {
    expect(canAccessPortalTraining({
      userType: "external_user",
      organizationType: "internal"
    })).toBe(false);
    expect(canAccessPortalTraining({
      userType: "internal_employee",
      organizationType: "customer"
    })).toBe(false);
  });

  it("allows brand employees to use the internal portal training surface", () => {
    expect(canAccessPortalTraining({
      userType: "external_user",
      organizationType: "customer",
      membershipType: "brand_employee"
    })).toBe(true);
  });
});
