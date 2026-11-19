import { api } from "../../../lib/api";

// Served by the admin process (/api/org-team), not the chat slots behind /api/portal.

export type TeamMember = {
  membershipId: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  membershipType: string;
  joinedAt: string | null;
  isSelf: boolean;
};

export type TeamInvite = {
  id: string;
  email: string;
  status: "pending" | "expired";
  membershipType: string;
  expiresAt: string;
  createdAt: string;
  invitedByEmail: string | null;
};

export type TeamJoinRequest = {
  id: string;
  email: string;
  contactName: string | null;
  message: string | null;
  status: string;
  createdAt: string;
};

export type TeamSubscription = {
  planName?: string;
  maxMembers?: number;
  completedTurnLimit: number | null;
  usedCompletedTurns: number | null;
  remainingCompletedTurns: number | null;
  cycleEndsAt?: string;
  expiresAt?: string;
  accessStatus: string;
};

export type TeamOverview = {
  organization: { id: string; name: string };
  seats: { used: number; limit: number | null; members: number; pendingInvites: number };
  allowedDomains: string[];
  invitesToday: { used: number; limit: number };
  subscription: TeamSubscription | null;
  members: TeamMember[];
  invites: TeamInvite[];
  joinRequests: TeamJoinRequest[];
};

export async function fetchTeam(): Promise<TeamOverview> {
  return (await api<{ team: TeamOverview }>("/api/org-team/team")).team;
}

export async function inviteTeamMember(email: string): Promise<TeamInvite> {
  return (await api<{ invite: TeamInvite }>("/api/org-team/team/invites", { method: "POST", json: { email } })).invite;
}

export async function revokeTeamInvite(inviteId: string): Promise<void> {
  await api(`/api/org-team/team/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

export async function removeTeamMember(membershipId: string): Promise<void> {
  await api(`/api/org-team/team/members/${encodeURIComponent(membershipId)}`, { method: "DELETE" });
}

export async function decideTeamJoinRequest(requestId: string, decision: "approve" | "reject"): Promise<void> {
  await api(`/api/org-team/team/join-requests/${encodeURIComponent(requestId)}/${decision}`, { method: "POST" });
}
