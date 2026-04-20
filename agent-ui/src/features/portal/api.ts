import { api } from "../../lib/api";

type PortalSubscriptionStatusPayload = {
  status: {
    access_state: "available" | "blocked";
    tone: "positive" | "caution" | "critical" | "neutral";
    source_type: "user" | "organization" | "default_internal" | "default_external";
    source_label: string;
    title: string;
    summary: string;
    detail: string;
    action_label?: string | null;
    plan_name?: string | null;
    expires_at?: string | null;
    cycle_ends_at?: string | null;
    remaining_completed_turns?: number | null;
    completed_turn_limit?: number | null;
    reason_code?: string | null;
  };
};

export type PortalSubscriptionStatus = {
  accessState: "available" | "blocked";
  tone: "positive" | "caution" | "critical" | "neutral";
  sourceType: "user" | "organization" | "default_internal" | "default_external";
  sourceLabel: string;
  title: string;
  summary: string;
  detail: string;
  actionLabel?: string;
  planName?: string;
  expiresAt?: string;
  cycleEndsAt?: string;
  remainingCompletedTurns: number | null;
  completedTurnLimit: number | null;
  reasonCode?: string;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizePortalSubscriptionStatus(payload: PortalSubscriptionStatusPayload["status"]): PortalSubscriptionStatus {
  return {
    accessState: payload.access_state,
    tone: payload.tone,
    sourceType: payload.source_type,
    sourceLabel: payload.source_label,
    title: payload.title,
    summary: payload.summary,
    detail: payload.detail,
    actionLabel: trimOrUndefined(payload.action_label),
    planName: trimOrUndefined(payload.plan_name),
    expiresAt: trimOrUndefined(payload.expires_at),
    cycleEndsAt: trimOrUndefined(payload.cycle_ends_at),
    remainingCompletedTurns: payload.remaining_completed_turns ?? null,
    completedTurnLimit: payload.completed_turn_limit ?? null,
    reasonCode: trimOrUndefined(payload.reason_code)
  };
}

export async function fetchPortalSubscriptionStatus(): Promise<PortalSubscriptionStatus> {
  const response = await api<PortalSubscriptionStatusPayload>("/api/portal/subscription-status");
  return normalizePortalSubscriptionStatus(response.status);
}
