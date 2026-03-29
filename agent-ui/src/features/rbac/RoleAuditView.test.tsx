import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoleAuditView } from "./RoleAuditView";

describe("RoleAuditView", () => {
  it("renders audit entries", () => {
    render(
      <RoleAuditView
        auditLogs={[
          {
            id: "audit-1",
            actorUserId: "admin-user",
            actionType: "role.updated",
            targetType: "role",
            targetId: "role-ops",
            createdAt: "2026-03-30T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(screen.getByText("role.updated")).toBeTruthy();
    expect(screen.getByText("admin-user")).toBeTruthy();
  });
});
