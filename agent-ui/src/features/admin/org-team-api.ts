import { api } from "../../lib/api";
import type { TeamOverview } from "../portal/roadmap/team-api";

export type OrgTeamEvent = {
  id: string;
  organizationId: string;
  eventType: string;
  actorType: string;
  actorUserId?: string;
  actorEmail?: string;
  targetEmail?: string;
  targetUserId?: string;
  detail?: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

export type PendingJoinRequest = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  contactName: string | null;
  message: string | null;
  createdAt: string;
};

const base = "/api/admin/org-team";
const org = (organizationId: string) => `${base}/organizations/${encodeURIComponent(organizationId)}`;

export function fetchAdminOrgTeam(organizationId: string): Promise<{ team: TeamOverview; events: OrgTeamEvent[] }> {
  return api(org(organizationId));
}

export async function fetchAdminPendingJoinRequests(): Promise<PendingJoinRequest[]> {
  return (await api<{ joinRequests: PendingJoinRequest[] }>(`${base}/join-requests`)).joinRequests;
}

export async function adminInviteOrgMember(organizationId: string, email: string, membershipType: "customer_admin" | "customer_member") {
  await api(`${org(organizationId)}/invites`, { method: "POST", json: { email, membershipType } });
}

export async function adminRevokeOrgInvite(organizationId: string, inviteId: string) {
  await api(`${org(organizationId)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

export async function adminChangeOrgMemberRole(organizationId: string, membershipId: string, membershipType: string) {
  await api(`${org(organizationId)}/members/${encodeURIComponent(membershipId)}`, { method: "PATCH", json: { membershipType } });
}

export async function adminRemoveOrgMember(organizationId: string, membershipId: string) {
  await api(`${org(organizationId)}/members/${encodeURIComponent(membershipId)}`, { method: "DELETE" });
}

export async function adminSetOrgInviteDomains(organizationId: string, domains: string[]): Promise<string[]> {
  return (await api<{ domains: string[] }>(`${org(organizationId)}/invite-domains`, { method: "PUT", json: { domains } })).domains;
}

export async function adminDecideOrgJoinRequest(organizationId: string, requestId: string, decision: "approve" | "reject") {
  await api(`${org(organizationId)}/join-requests/${encodeURIComponent(requestId)}/${decision}`, { method: "POST" });
}

const EVENT_LABELS: Record<string, string> = {
  member_invited: "发送邀请",
  invite_revoked: "撤销邀请",
  member_removed: "移除成员",
  member_role_changed: "调整角色",
  join_requested: "申请加入",
  join_approved: "批准加入",
  join_rejected: "拒绝加入",
  invite_domains_updated: "修改邀请域名"
};

const ACTOR_LABELS: Record<string, string> = {
  customer_admin: "组织管理员",
  platform_admin: "平台管理员",
  applicant: "申请人"
};

export function orgTeamEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

export function orgTeamActorLabel(actorType: string): string {
  return ACTOR_LABELS[actorType] ?? actorType;
}

/** One-line description of what changed, for the audit list. */
export function orgTeamEventSummary(event: OrgTeamEvent): string {
  const meta = event.metadata ?? {};
  if (event.eventType === "member_role_changed") {
    const role = (value: unknown) => (value === "customer_admin" ? "组织管理员" : value === "customer_member" ? "成员" : String(value ?? ""));
    return `${event.targetEmail ?? ""} ${role(meta.from)} → ${role(meta.to)}`.trim();
  }
  if (event.eventType === "invite_domains_updated") {
    const list = (value: unknown) => (Array.isArray(value) && value.length ? value.join(", ") : "无");
    return `${list(meta.from)} → ${list(meta.to)}`;
  }
  if (event.eventType === "member_invited" && meta.source === "join_request") {
    return `${event.targetEmail ?? ""}（来自加入申请）`;
  }
  return event.targetEmail ?? event.detail ?? "";
}
