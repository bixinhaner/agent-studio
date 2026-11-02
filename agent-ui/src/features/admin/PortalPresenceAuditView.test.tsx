import { describe, expect, it } from "vitest";

import { presenceRanges, toLocalInputValue } from "./PortalPresenceAuditView";

describe("portal presence audit view", () => {
  it("joins consecutive slots into local-time ranges", () => {
    const at = (h: number, m: number) => new Date(2026, 10, 2, h, m).toISOString();
    expect(presenceRanges([at(9, 0), at(9, 10), at(9, 20), at(11, 30)], 10)).toEqual(["09:00–09:30", "11:30–11:40"]);
  });

  it("formats datetime-local values in the viewer's time zone", () => {
    expect(toLocalInputValue(new Date(2026, 10, 2, 7, 5))).toBe("2026-11-02T07:05");
  });
});
