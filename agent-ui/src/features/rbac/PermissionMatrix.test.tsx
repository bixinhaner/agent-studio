import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PermissionMatrix } from "./PermissionMatrix";

describe("PermissionMatrix", () => {
  it("toggles grouped permissions", () => {
    const onToggle = vi.fn();

    render(
      <PermissionMatrix
        permissions={[
          { id: "permission-role-write", key: "role.write", name: "Edit roles", category: "role_management", isSystem: true, isActive: true }
        ]}
        selectedPermissionIds={[]}
        onToggle={onToggle}
      />
    );

    fireEvent.click(screen.getByLabelText("permission role.write"));
    expect(onToggle).toHaveBeenCalledWith("permission-role-write", true);
  });
});
