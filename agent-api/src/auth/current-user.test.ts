import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { requireInternalOrganizationMember, userOut } from "./current-user.js";

function responseDouble() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { response: { status } as unknown as Response, status, json };
}

describe("requireInternalOrganizationMember", () => {
  it("rejects anonymous access", () => {
    const { response, status, json } = responseDouble();
    const next = vi.fn() as NextFunction;

    requireInternalOrganizationMember({} as Request, response, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ detail: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an active customer organization member", () => {
    const { response, status, json } = responseDouble();
    const next = vi.fn() as NextFunction;
    const request = {
      currentUser: { id: "external-user" },
      currentOrganization: { id: "customer-org", type: "customer" },
      currentMembership: { status: "active" }
    } as Request;

    requireInternalOrganizationMember(request, response, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ detail: "Internal employee access is required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows an active internal organization member", () => {
    const { response, status } = responseDouble();
    const next = vi.fn() as NextFunction;
    const request = {
      currentUser: { id: "employee" },
      currentOrganization: { id: "internal-org", type: "internal" },
      currentMembership: { status: "active" }
    } as Request;

    requireInternalOrganizationMember(request, response, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows a brand employee without granting internal organization membership", () => {
    const { response, status } = responseDouble();
    const next = vi.fn() as NextFunction;
    const request = {
      currentUser: { id: "ranley-employee", userType: "external_user" },
      currentOrganization: { id: "ranley-employees", type: "customer" },
      currentMembership: { status: "active", membershipType: "brand_employee" }
    } as Request;

    requireInternalOrganizationMember(request, response, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("userOut", () => {
  it("returns dismissed feature announcements in the portal preferences payload", () => {
    expect(userOut({
      id: "employee",
      email: "employee@example.com",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      portalPreferences: {
        dismissedFeatureAnnouncements: ["skill-sharing-v1"]
      }
    })).toMatchObject({
      portal_preferences: {
        dismissed_feature_announcements: ["skill-sharing-v1"]
      }
    });
  });
});
