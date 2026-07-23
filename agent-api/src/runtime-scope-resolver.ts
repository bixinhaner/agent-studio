import { createHash } from "node:crypto";
import path from "node:path";

export type RuntimeScopeActor = {
  organizationId: string;
  organizationSlug?: string;
  userId: string;
};

export type CodexCapabilityFingerprint = {
  mode: string;
  mcpServers?: unknown;
  mcp_servers?: unknown;
};

export type SharedCodexHomeScope = {
  capabilityHash: string;
  fingerprint: CodexCapabilityFingerprint;
  scopeSegments: string[];
  manifest: {
    version: 1;
    scope: "user_agent";
    organizationKey: string;
    userId: string;
    modeId: string;
    capabilityHash: string;
    fingerprint: CodexCapabilityFingerprint;
  };
};

export type SharedIntegrationCodexHomeScope = {
  capabilityHash: string;
  fingerprint: CodexCapabilityFingerprint;
  scopeSegments: string[];
  manifest: {
    version: 1;
    scope: "integration_agent";
    provider: string;
    integrationInstanceId: string;
    modeId: string;
    capabilityHash: string;
    fingerprint: CodexCapabilityFingerprint;
  };
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

export function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, (_key, currentValue) => {
      if (currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) {
        const record = currentValue as Record<string, unknown>;
        return Object.keys(record)
          .sort((left, right) => left.localeCompare(right))
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = record[key];
            return acc;
          }, {});
      }
      return currentValue;
    });
  } catch {
    return String(value);
  }
}

function shortHash(value: unknown, length = 12): string {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, length);
}

function organizationKeyOf(actor: RuntimeScopeActor): string {
  return trimOrUndefined(actor.organizationSlug) ?? actor.organizationId;
}

export function buildUserAgentWorkspacePath(input: {
  rootPath: string;
  actor: RuntimeScopeActor;
  modeId: string;
  securityDomainId?: string;
}): string {
  const securityDomainId = trimOrUndefined(input.securityDomainId);
  const domainSegments = securityDomainId
    ? ["security-domains", sanitizePathSegment(securityDomainId, "domain")]
    : [];
  return path.join(
    input.rootPath,
    sanitizePathSegment(organizationKeyOf(input.actor), "organization"),
    ...domainSegments,
    sanitizePathSegment(input.actor.userId, "user"),
    `agent-${sanitizePathSegment(input.modeId, "default")}`
  );
}

export function buildIntegrationAgentWorkspacePath(input: {
  rootPath: string;
  provider: string;
  integrationInstanceId: string;
  modeId: string;
}): string {
  return path.join(
    input.rootPath,
    "integrations",
    sanitizePathSegment(input.provider, "integration"),
    sanitizePathSegment(input.integrationInstanceId, "instance"),
    `agent-${sanitizePathSegment(input.modeId, "default")}`
  );
}

export function isIntegrationAgentWorkspacePath(input: {
  rootPath: string;
  provider: string;
  integrationInstanceId: string;
  modeId: string;
  workspacePath: string;
}): boolean {
  return path.resolve(input.workspacePath) === path.resolve(buildIntegrationAgentWorkspacePath(input));
}

export function isUserAgentWorkspacePath(input: {
  rootPath: string;
  actor: RuntimeScopeActor;
  modeId: string;
  workspacePath: string;
}): boolean {
  return path.resolve(input.workspacePath) === path.resolve(buildUserAgentWorkspacePath(input));
}

export function buildCodexCapabilityFingerprint(input: {
  modeId: string;
  codexRunConfig?: Record<string, unknown>;
}): CodexCapabilityFingerprint {
  const config = input.codexRunConfig ?? {};
  return {
    mode: input.modeId,
    ...(config.mcpServers !== undefined ? { mcpServers: config.mcpServers } : {}),
    ...(config.mcp_servers !== undefined ? { mcp_servers: config.mcp_servers } : {})
  };
}

export function buildSharedCodexHomeScope(input: {
  actor: RuntimeScopeActor;
  modeId: string;
  codexRunConfig?: Record<string, unknown>;
}): SharedCodexHomeScope {
  const organizationKey = organizationKeyOf(input.actor);
  const fingerprint = buildCodexCapabilityFingerprint({
    modeId: input.modeId,
    codexRunConfig: input.codexRunConfig
  });
  const capabilityHash = shortHash(fingerprint);
  return {
    capabilityHash,
    fingerprint,
    scopeSegments: [
      sanitizePathSegment(organizationKey, "organization"),
      sanitizePathSegment(input.actor.userId, "user"),
      `agent-${sanitizePathSegment(input.modeId, "default")}-${capabilityHash}`
    ],
    manifest: {
      version: 1,
      scope: "user_agent",
      organizationKey,
      userId: input.actor.userId,
      modeId: input.modeId,
      capabilityHash,
      fingerprint
    }
  };
}

export function buildSharedIntegrationCodexHomeScope(input: {
  provider: string;
  integrationInstanceId: string;
  modeId: string;
  codexRunConfig?: Record<string, unknown>;
}): SharedIntegrationCodexHomeScope {
  const provider = sanitizePathSegment(input.provider, "integration");
  const integrationInstanceId = sanitizePathSegment(input.integrationInstanceId, "instance");
  const fingerprint = buildCodexCapabilityFingerprint({
    modeId: input.modeId,
    codexRunConfig: input.codexRunConfig
  });
  const capabilityHash = shortHash(fingerprint);
  return {
    capabilityHash,
    fingerprint,
    scopeSegments: [
      "integrations",
      provider,
      integrationInstanceId,
      `agent-${sanitizePathSegment(input.modeId, "default")}-${capabilityHash}`
    ],
    manifest: {
      version: 1,
      scope: "integration_agent",
      provider,
      integrationInstanceId,
      modeId: input.modeId,
      capabilityHash,
      fingerprint
    }
  };
}
