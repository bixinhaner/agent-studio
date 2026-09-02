import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../lib/api";
import {
  managedSkillInstallConflictFromError,
  SkillInstallConflictDialog
} from "./SkillInstallConflictDialog";

beforeAll(() => {
  const getComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: (element: Element) => getComputedStyle(element)
  });
});

afterEach(cleanup);

describe("SkillInstallConflictDialog", () => {
  it("parses only the structured shared-name conflict", () => {
    const conflict = managedSkillInstallConflictFromError(new ApiError({
      message: "conflict",
      detail: "conflict",
      status: 409,
      code: "SKILL_NAME_SHARED_CONFLICT",
      payload: {
        conflict: {
          skillId: "shared-1",
          skillName: "tp-generator",
          ownerUserId: "owner-1",
          ownerDisplayName: "Owner",
          suggestedName: "tp-generator-personal"
        }
      }
    }));

    expect(conflict).toEqual(expect.objectContaining({
      skillId: "shared-1",
      skillName: "tp-generator",
      suggestedName: "tp-generator-personal"
    }));
    expect(managedSkillInstallConflictFromError(new Error("conflict"))).toBeUndefined();
  });

  it("makes keeping the shared Skill and creating a copy explicit", () => {
    const onKeepShared = vi.fn();
    const onCreateCopy = vi.fn();
    render(
      <SkillInstallConflictDialog
        open
        conflict={{
          skillId: "shared-1",
          skillName: "tp-generator",
          ownerUserId: "owner-1",
          ownerDisplayName: "Owner",
          suggestedName: "tp-generator-personal"
        }}
        loading={false}
        onKeepShared={onKeepShared}
        onCreateCopy={onCreateCopy}
      />
    );

    expect(screen.getByText("tp-generator-personal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /继续使用共享 Skill|Keep shared Skill/ }));
    expect(onKeepShared).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /创建个人副本|Create personal copy/ }));
    expect(onCreateCopy).toHaveBeenCalledOnce();
  });
});
