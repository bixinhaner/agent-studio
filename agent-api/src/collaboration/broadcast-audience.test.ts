import { describe, expect, it } from "vitest";

import { BroadcastAudienceResolver } from "./broadcast-audience.js";

describe("BroadcastAudienceResolver", () => {
  it("resolves include and default email exclusions for external customers", async () => {
    const resolver = new BroadcastAudienceResolver({
      user: {
        findMany: async () => [
          {
            id: "user-1",
            email: "active@example.com",
            displayName: "Active Customer",
            status: "active",
            role: "customer_member",
            userType: "external_customer",
            primaryOrganizationId: "org-1",
            manualDisabled: false,
            preferencesJson: {},
            primaryOrganization: { id: "org-1", name: "Customer Org", type: "customer", status: "active" },
            organizationMemberships: []
          },
          {
            id: "user-2",
            email: "optout@example.com",
            displayName: "Opt Out",
            status: "active",
            role: "customer_member",
            userType: "external_customer",
            primaryOrganizationId: "org-1",
            manualDisabled: false,
            preferencesJson: { marketingEmailOptOut: true },
            primaryOrganization: { id: "org-1", name: "Customer Org", type: "customer", status: "active" },
            organizationMemberships: []
          },
          {
            id: "user-3",
            email: null,
            displayName: "No Email",
            status: "active",
            role: "customer_member",
            userType: "external_customer",
            primaryOrganizationId: "org-1",
            manualDisabled: false,
            preferencesJson: {},
            primaryOrganization: { id: "org-1", name: "Customer Org", type: "customer", status: "active" },
            organizationMemberships: []
          },
          {
            id: "user-4",
            email: "internal@example.com",
            displayName: "Internal User",
            status: "active",
            role: "employee",
            userType: "internal_employee",
            primaryOrganizationId: "org-2",
            manualDisabled: false,
            preferencesJson: {},
            primaryOrganization: { id: "org-2", name: "Internal Org", type: "internal", status: "active" },
            organizationMemberships: []
          }
        ]
      }
    });

    const preview = await resolver.preview({
      include: [{ type: "organization_type", value: "external" }],
      exclude: [{ type: "disabled_users" }, { type: "missing_email" }, { type: "email_opt_out" }]
    });

    expect(preview.recipients.map((recipient) => recipient.userId)).toEqual(["user-1"]);
    expect(preview.snapshot.recipientCount).toBe(1);
    expect(preview.snapshot.externalCount).toBe(1);
    expect(preview.excluded.emailOptOut).toBe(1);
    expect(preview.excluded.missingEmail).toBe(1);
  });
});
