import { describe, expect, it, vi } from "vitest";

import { createTeamUsageService, primaryDepartmentId, rankAmong, resolveTeamScope, TeamUsageAccessError, type OrgDirectory } from "./team-usage-service.js";

// boss → lead → (a, b); lead also leads dept "eng" (with sub-dept "eng-fe"); c sits in eng-fe with another manager.
const directory: OrgDirectory = {
  users: [
    { id: "boss", displayName: "Boss", email: null, dingtalkUserId: "d-boss" },
    { id: "lead", displayName: "Lead", email: null, dingtalkUserId: "d-lead" },
    { id: "a", displayName: "Alice", email: null, dingtalkUserId: "d-a" },
    { id: "b", displayName: null, email: "b@x.com", dingtalkUserId: "d-b" },
    { id: "c", displayName: "Carol", email: null, dingtalkUserId: "d-c" },
    { id: "z", displayName: "Zed", email: null, dingtalkUserId: "d-z" },
    { id: "x", displayName: "X", email: null, dingtalkUserId: "d-x" },
    { id: "y", displayName: "Y", email: null, dingtalkUserId: "d-y" }
  ],
  profiles: [
    { userId: "lead", managerDingTalkUserId: "d-boss", title: "Manager" },
    { userId: "a", managerDingTalkUserId: "d-lead", title: "Engineer" },
    { userId: "b", managerDingTalkUserId: "d-lead", title: null },
    { userId: "c", managerDingTalkUserId: "d-z", title: null },
    // Directory cycles and self-references must not loop or self-include.
    { userId: "x", managerDingTalkUserId: "d-y", title: null },
    { userId: "y", managerDingTalkUserId: "d-x", title: null },
    { userId: "z", managerDingTalkUserId: "d-z", title: null },
    // Disabled users are not in `users` and must not appear.
    { userId: "gone", managerDingTalkUserId: "d-lead", title: null }
  ],
  memberships: [
    { userId: "lead", departmentId: "eng", isPrimary: true, isLeader: true, sortOrder: 0 },
    { userId: "a", departmentId: "eng", isPrimary: true, isLeader: false, sortOrder: 0 },
    { userId: "b", departmentId: "sales", isPrimary: false, isLeader: false, sortOrder: 2 },
    { userId: "b", departmentId: "eng", isPrimary: false, isLeader: false, sortOrder: 1 },
    { userId: "c", departmentId: "eng-fe", isPrimary: true, isLeader: false, sortOrder: 0 },
    { userId: "z", departmentId: "sales", isPrimary: true, isLeader: false, sortOrder: 0 },
    { userId: "a", departmentId: "old", isPrimary: false, isLeader: false, sortOrder: 0 }
  ],
  departments: [
    { id: "eng", name: "Engineering", parentDepartmentId: null, status: "active" },
    { id: "eng-fe", name: "Frontend", parentDepartmentId: "eng", status: "active" },
    { id: "sales", name: "Sales", parentDepartmentId: null, status: "active" },
    { id: "old", name: "Old", parentDepartmentId: null, status: "inactive" }
  ]
};

describe("resolveTeamScope", () => {
  it("combines the manager chain with led departments and their sub-departments", () => {
    const scope = resolveTeamScope(directory, "lead");
    expect(Object.fromEntries(scope)).toEqual({ a: "direct", b: "direct", c: "department" });
  });

  it("marks indirect reports, survives cycles and never includes the viewer", () => {
    const scope = resolveTeamScope(directory, "boss");
    expect(scope.get("lead")).toBe("direct");
    expect(scope.get("a")).toBe("indirect");
    expect(scope.has("boss")).toBe(false);
    expect(scope.has("gone")).toBe(false);
    expect(Object.fromEntries(resolveTeamScope(directory, "x"))).toEqual({ y: "direct" });
  });

  it("gives individual contributors an empty scope", () => {
    expect(resolveTeamScope(directory, "c").size).toBe(0);
    expect(resolveTeamScope(directory, "z").size).toBe(1);
  });
});

describe("ranking helpers", () => {
  it("prefers the primary department, then sort order, ignoring inactive departments", () => {
    expect(primaryDepartmentId(directory, "a")).toBe("eng");
    expect(primaryDepartmentId(directory, "b")).toBe("eng");
    expect(primaryDepartmentId(directory, "nobody")).toBeNull();
  });

  it("uses competition ranking and leaves zero-usage viewers unranked", () => {
    const tokens = new Map([["a", 100], ["b", 300], ["c", 100], ["d", 0]]);
    expect(rankAmong(["a", "b", "c", "d"], "a", tokens)).toEqual({ rank: 2, size: 4, active: 3 });
    expect(rankAmong(["a", "b", "c", "d"], "c", tokens)).toEqual({ rank: 2, size: 4, active: 3 });
    expect(rankAmong(["a", "b", "c", "d"], "d", tokens)).toEqual({ rank: null, size: 4, active: 3 });
  });
});

function service() {
  const db = {
    user: { findMany: vi.fn(async () => directory.users) },
    enterpriseUserProfile: { findMany: vi.fn(async () => directory.profiles) },
    departmentMembership: { findMany: vi.fn(async () => directory.memberships) },
    department: { findMany: vi.fn(async () => directory.departments) }
  };
  const ledger = {
    sumByUserInRange: vi.fn(async (input: { userIds?: string[] }) =>
      [
        { userId: "a", totalTokens: 500, turns: 5, tasks: 2, lastActiveAt: "2026-10-05T01:00:00.000Z" },
        { userId: "lead", totalTokens: 200, turns: 2, tasks: 1, lastActiveAt: null },
        { userId: "z", totalTokens: 900, turns: 9, tasks: 3, lastActiveAt: null }
      ].filter((row) => !input.userIds || input.userIds.includes(row.userId))
    )
  };
  const personalUsage = { summarize: vi.fn(async (input: { userId: string }) => ({ userId: input.userId }) as never) };
  return { ledger, personalUsage, svc: createTeamUsageService({ db, ledger, personalUsage, now: () => new Date("2026-10-06T08:00:00Z") }) };
}

describe("createTeamUsageService", () => {
  it("ranks the viewer within the primary department and the company", async () => {
    const { svc } = service();
    const result = await svc.ranking({ viewerId: "lead", period: "month", timezone: "Asia/Shanghai" });
    expect(result.total_tokens).toBe(200);
    // eng members: lead, a, b → a(500) ahead of lead(200).
    expect(result.department).toMatchObject({ id: "eng", name: "Engineering", rank: 2, size: 3, active: 2 });
    expect(result.company).toEqual({ rank: 3, size: 8, active: 3 });
    expect(result.team).toEqual({ available: true, size: 3 });
  });

  it("returns only in-scope members, sorted by tokens, with team totals", async () => {
    const { svc, ledger } = service();
    const result = await svc.team({ viewerId: "lead", period: "7d" });
    expect(ledger.sumByUserInRange).toHaveBeenCalledWith(expect.objectContaining({ userIds: ["a", "b", "c"] }));
    expect(result.members.map((item) => item.user_id)).toEqual(["a", "b", "c"]);
    expect(result.members[0]).toMatchObject({ name: "Alice", title: "Engineer", department: "Engineering", relation: "direct", total_tokens: 500, tasks: 2 });
    expect(result.members[1]).toMatchObject({ name: "b@x.com", total_tokens: 0 });
    expect(result.totals).toEqual({ members: 3, active_members: 1, total_tokens: 500, turns: 5, tasks: 2 });
  });

  it("rejects team and member views outside the viewer's scope", async () => {
    const { svc, personalUsage } = service();
    await expect(svc.team({ viewerId: "c" })).rejects.toBeInstanceOf(TeamUsageAccessError);
    await expect(svc.member({ viewerId: "lead", memberId: "z" })).rejects.toBeInstanceOf(TeamUsageAccessError);
    await expect(svc.member({ viewerId: "lead", memberId: "lead" })).rejects.toBeInstanceOf(TeamUsageAccessError);
    expect(personalUsage.summarize).not.toHaveBeenCalled();

    const detail = await svc.member({ viewerId: "lead", memberId: "c", period: "30d" });
    expect(detail.member).toMatchObject({ name: "Carol", department: "Frontend", relation: "department" });
    expect(personalUsage.summarize).toHaveBeenCalledWith({ userId: "c", period: "30d", timezone: undefined });
  });

  it("requires a viewer id", async () => {
    const { svc } = service();
    await expect(svc.ranking({ viewerId: " " })).rejects.toThrow("signed-in");
  });
});

describe("preview grants", () => {
  it("parses grants and drops expired or malformed entries", async () => {
    const { parsePreviewGrants } = await import("./team-usage-service.js");
    const now = new Date("2026-10-06T08:00:00Z");
    const grants = parsePreviewGrants("u1:d1|d2:2026-10-06; u2:d3:2026-10-05;bad;u3::2026-12-01;u4:d4:soon", now);
    expect(Object.fromEntries(grants)).toEqual({ u1: ["d1", "d2"] });
  });

  it("treats a granted viewer as leader of the department until it expires", async () => {
    const make = (now: string) =>
      createTeamUsageService({
        db: {
          user: { findMany: vi.fn(async () => directory.users) },
          enterpriseUserProfile: { findMany: vi.fn(async () => directory.profiles) },
          departmentMembership: { findMany: vi.fn(async () => directory.memberships) },
          department: { findMany: vi.fn(async () => directory.departments) }
        },
        ledger: { sumByUserInRange: vi.fn(async () => []) },
        personalUsage: { summarize: vi.fn() },
        now: () => new Date(now),
        previewGrants: () => "c:sales:2026-10-06"
      });
    const active = await make("2026-10-06T20:00:00Z").team({ viewerId: "c" });
    expect(active.members.map((item) => [item.user_id, item.relation])).toEqual([["b", "department"], ["z", "department"]]);
    await expect(make("2026-10-07T00:00:01Z").team({ viewerId: "c" })).rejects.toBeInstanceOf(TeamUsageAccessError);
  });
});
