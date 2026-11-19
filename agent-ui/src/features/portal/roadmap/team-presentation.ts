import type { TeamOverview, TeamSubscription } from "./team-api";

/** True when members plus live invitations already fill the plan's seats. */
export function isTeamFull(team: Pick<TeamOverview, "seats">): boolean {
  return team.seats.limit !== null && team.seats.used >= team.seats.limit;
}

export function formatDomainList(domains: string[]): string {
  return domains.map((domain) => `@${domain}`).join(" / ");
}

export type TeamQuotaParts = {
  used: number;
  limit: number | null;
  planName?: string;
  cycleEndsAt?: string;
  expiresAt?: string;
};

export function teamQuotaParts(subscription: TeamSubscription | null): TeamQuotaParts | null {
  if (!subscription) return null;
  return {
    used: subscription.usedCompletedTurns ?? 0,
    limit: subscription.completedTurnLimit,
    planName: subscription.planName,
    cycleEndsAt: subscription.cycleEndsAt,
    expiresAt: subscription.expiresAt
  };
}
