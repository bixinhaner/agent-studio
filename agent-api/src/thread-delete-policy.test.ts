import { describe, expect, it } from "vitest";

import {
  isHardThreadDeleteRequested,
  resolveThreadDeleteMode
} from "./thread-delete-policy.js";

describe("thread delete policy", () => {
  it("uses archive mode by default for user-side deletes", () => {
    expect(resolveThreadDeleteMode({ query: {}, role: "employee" })).toEqual({ mode: "archive" });
  });

  it("rejects hard deletes from non-super-admin users", () => {
    expect(resolveThreadDeleteMode({ query: { hard: "true" }, role: "employee" })).toEqual({
      mode: "forbidden",
      detail: "Only super admins can permanently delete threads"
    });
    expect(resolveThreadDeleteMode({ query: { hard: "true" }, role: "admin" })).toEqual({
      mode: "forbidden",
      detail: "Only super admins can permanently delete threads"
    });
  });

  it("allows super admins to request hard deletes explicitly", () => {
    expect(resolveThreadDeleteMode({ query: { hard: "true" }, role: "super_admin" })).toEqual({ mode: "hard" });
    expect(resolveThreadDeleteMode({ query: { permanent: "1" }, role: "super_admin" })).toEqual({ mode: "hard" });
  });

  it("recognizes common hard-delete query flags", () => {
    expect(isHardThreadDeleteRequested({ hard: "hard" })).toBe(true);
    expect(isHardThreadDeleteRequested({ permanent: ["yes"] })).toBe(true);
    expect(isHardThreadDeleteRequested({ hard: "false" })).toBe(false);
  });
});
