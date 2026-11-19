import { describe, expect, it } from "vitest";

import { orgTeamEventLabel, orgTeamEventSummary } from "./org-team-api";

describe("org team audit labels", () => {
  it("describes role and domain changes in Chinese", () => {
    const base = { id: "e", organizationId: "o", actorType: "platform_admin", createdAt: "2026-11-19T00:00:00.000Z" };
    expect(orgTeamEventSummary({ ...base, eventType: "member_role_changed", targetEmail: "eva@x.de", metadata: { from: "customer_member", to: "customer_admin" } })).toBe(
      "eva@x.de 成员 → 组织管理员"
    );
    expect(orgTeamEventSummary({ ...base, eventType: "invite_domains_updated", metadata: { from: [], to: ["x.com"] } })).toBe("无 → x.com");
    expect(orgTeamEventSummary({ ...base, eventType: "member_invited", targetEmail: "b@x.de", metadata: { source: "join_request" } })).toBe("b@x.de（来自加入申请）");
    expect(orgTeamEventLabel("join_requested")).toBe("申请加入");
    expect(orgTeamEventLabel("unknown_event")).toBe("unknown_event");
  });
});
