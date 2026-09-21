import { createHash } from "node:crypto";

import type { ConnectorEventEnvelope } from "./contracts.js";
import type { ScenarioSpec } from "./scenario-catalog.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function resourcePartition(event: ConnectorEventEnvelope): string {
  const requested = event.conversationScope?.partition?.trim();
  if (requested) return requested;

  // Older xOMC events do not carry an explicit partition. Prefer a stable
  // managed-resource identity; never use eventId, alarmId, or taskId when a
  // device/group scope is available.
  const preferred = ["device", "ne_group", "site", "candidate", "task", "scope"];
  for (const type of preferred) {
    const match = event.resources.find((resource) => resource.type === type || resource.role === type);
    if (match) return `${match.type}:${match.id}`;
  }
  return "scope:global";
}

export function proactiveConversationId(input: {
  connectorId: string;
  externalUserId: string;
  scenario: Pick<ScenarioSpec, "key" | "version" | "agent">;
  event: ConnectorEventEnvelope;
  locale: string;
}): string {
  const scope = createHash("sha256").update(canonical({
    connectorId: input.connectorId,
    externalUserId: input.externalUserId,
    tenantRef: input.event.tenantRef ?? null,
    scenarioKey: input.scenario.key,
    scenarioVersion: input.scenario.version,
    packageDigest: input.event.integrationPack.digest,
    handbookDigest: input.event.handbookDigest,
    resourcePartition: resourcePartition(input.event),
    allowedMethods: ["GET"],
    allowedOperations: [...input.scenario.agent.allowedOperations].sort(),
    authorizationDigest: input.event.conversationScope?.authorizationDigest ?? null,
    locale: input.locale
  })).digest("hex");
  return `proactive-${input.scenario.key}-${scope}`;
}

export function fallbackResourcePartition(event: ConnectorEventEnvelope): string {
  return resourcePartition(event);
}
