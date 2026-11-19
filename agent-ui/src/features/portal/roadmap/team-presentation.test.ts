import { describe, expect, it } from "vitest";

import { formatDomainList, isTeamFull, teamQuotaParts } from "./team-presentation";

describe("team presentation", () => {
  it("treats a missing seat limit as unlimited", () => {
    expect(isTeamFull({ seats: { used: 40, limit: null, members: 40, pendingInvites: 0 } })).toBe(false);
    expect(isTeamFull({ seats: { used: 5, limit: 5, members: 3, pendingInvites: 2 } })).toBe(true);
  });

  it("lists allowed domains with an @ prefix", () => {
    expect(formatDomainList(["opticoms.de", "opticoms.com"])).toBe("@opticoms.de / @opticoms.com");
    expect(formatDomainList([])).toBe("");
  });

  it("shows zero used requests before the first one", () => {
    expect(
      teamQuotaParts({ completedTurnLimit: 300, usedCompletedTurns: null, remainingCompletedTurns: null, accessStatus: "available", planName: "Trial" })
    ).toMatchObject({ used: 0, limit: 300, planName: "Trial" });
    expect(teamQuotaParts(null)).toBeNull();
  });
});
