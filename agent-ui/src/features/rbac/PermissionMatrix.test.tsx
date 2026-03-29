import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PermissionMatrix } from "./PermissionMatrix";

describe("PermissionMatrix", () => {
  it("groups permissions by category and toggles selection", () => {
    const onToggle = vi.fn();

    render(
      <PermissionMatrix
        permissions={[
          { id: "perm-role-read", key: "role.read", name: "Read roles", category: "role", isSystem: true, isActive: true },
          { id: "perm-user-read", key: "user.read", name: "Read users", category: "user", isSystem: true, isActive: true }
        ]}
        selectedPermissionIds={["perm-role-read"]}
        onToggle={onToggle}
      />
    );

    expect(screen.getByText("role")).toBeTruthy();
    expect(screen.getByText("user")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("permission user.read"));

    expect(onToggle).toHaveBeenCalledWith("perm-user-read", true);
  });
});
