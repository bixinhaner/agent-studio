import { describe, expect, it } from "vitest";

import { brandEmployeeOrganizationIdForEmail, emailDomain } from "./employee-access.js";

describe("brand employee email access", () => {
  const brand = {
    employeeEmailDomains: ["cloud-ran.ai"],
    employeeOrganizationId: "org-ranley-employees"
  };

  it("matches configured domains case-insensitively", () => {
    expect(emailDomain("Lion.Li@Cloud-Ran.AI")).toBe("cloud-ran.ai");
    expect(brandEmployeeOrganizationIdForEmail(brand, "Lion.Li@Cloud-Ran.AI"))
      .toBe("org-ranley-employees");
  });

  it("does not match subdomains or unrelated brands", () => {
    expect(brandEmployeeOrganizationIdForEmail(brand, "user@sub.cloud-ran.ai")).toBeUndefined();
    expect(brandEmployeeOrganizationIdForEmail(brand, "user@baicells.com")).toBeUndefined();
  });
});
