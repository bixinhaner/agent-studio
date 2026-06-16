import { afterEach, describe, expect, it } from "vitest";

import {
  isInternalAuthSession,
  readPreferredAuthEntryMode,
  rememberPreferredAuthEntryMode,
  rememberSessionAuthEntryMode
} from "./auth-entry-preference";
import type { AuthSession } from "./api";

function buildSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    user: {
      id: "user-1",
      role: "employee",
      userType: "external_user"
    },
    activeOrganization: {
      id: "org-customer",
      slug: "customer",
      name: "Customer Org",
      type: "customer",
      status: "active"
    },
    memberships: [],
    identities: [],
    ...overrides
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe("auth entry preference", () => {
  it("remembers internal sessions by user type", () => {
    const mode = rememberSessionAuthEntryMode(
      buildSession({
        user: {
          id: "user-1",
          role: "employee",
          userType: "internal_employee"
        }
      })
    );

    expect(mode).toBe("internal");
    expect(readPreferredAuthEntryMode()).toBe("internal");
  });

  it("remembers internal sessions by active organization", () => {
    const mode = rememberSessionAuthEntryMode(
      buildSession({
        activeOrganization: {
          id: "org-internal",
          slug: "internal",
          name: "Internal",
          type: "internal",
          status: "active"
        }
      })
    );

    expect(mode).toBe("internal");
    expect(readPreferredAuthEntryMode()).toBe("internal");
  });

  it("remembers external sessions when no internal ownership exists", () => {
    const mode = rememberSessionAuthEntryMode(buildSession());

    expect(mode).toBe("external");
    expect(readPreferredAuthEntryMode()).toBe("external");
  });

  it("detects internal membership even when active organization is external", () => {
    expect(
      isInternalAuthSession({
        user: { userType: "external_user" },
        activeOrganization: { type: "customer" },
        memberships: [
          {
            organization: {
              id: "org-internal",
              slug: "internal",
              name: "Internal",
              type: "internal",
              status: "active"
            }
          }
        ]
      })
    ).toBe(true);
  });

  it("ignores invalid stored values", () => {
    window.localStorage.setItem("agent_studio_auth_entry_mode", "unknown");

    expect(readPreferredAuthEntryMode()).toBeNull();
  });

  it("can explicitly remember DingTalk internal intent before the session exists", () => {
    rememberPreferredAuthEntryMode("internal");

    expect(readPreferredAuthEntryMode()).toBe("internal");
  });
});
