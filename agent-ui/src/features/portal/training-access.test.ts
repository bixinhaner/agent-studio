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
});
