import { api } from "../../lib/api";
import type { ZendeskOverview, ZendeskSettingsUpdate } from "./types";

export async function fetchZendeskOverview(): Promise<ZendeskOverview> {
  return await api<ZendeskOverview>("/api/integrations/zendesk/overview");
}

export async function saveZendeskSettings(payload: ZendeskSettingsUpdate): Promise<ZendeskOverview> {
  return await api<ZendeskOverview>("/api/integrations/zendesk/settings", {
    method: "PUT",
    json: payload
  });
}

export async function validateZendeskConnection(): Promise<{ ok: true; overview: ZendeskOverview }> {
  return await api<{ ok: true; overview: ZendeskOverview }>("/api/integrations/zendesk/validate", {
    method: "POST"
  });
}

export async function runZendeskTicket(ticketId: string): Promise<{ ok: true; result: unknown; overview: ZendeskOverview }> {
  return await api<{ ok: true; result: unknown; overview: ZendeskOverview }>("/api/integrations/zendesk/run", {
    method: "POST",
    json: { ticket_id: ticketId }
  });
}
