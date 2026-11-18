import { createHash } from "node:crypto";
import type { ExecutionRequest } from "./contracts.js";

export function assistantConversationId(request: ExecutionRequest, run: { id: string; runAttempt: number }): string {
  // Old source requests cannot attest to role/data visibility. Keep their old
  // isolation until the source begins supplying an authoritative scope digest.
  if (!request.contextScopeDigest) return `assistant-${run.id}-${run.runAttempt}`;
  const methods = [...new Set((request.definition.allowedMethods ?? ["GET"])
    .filter((method) => !request.toolPolicy || request.toolPolicy.allowedMethods.includes(method)))].sort();
  const grants = request.definition.apiAccess === "discover"
    ? (request.toolGrants ?? []).filter((g) => methods.includes(g.method)).map((g) => `${g.method}:${g.operationId}`)
    : request.definition.operations.map((id) => `GET:${id}`);
  const blockedPaths = [...new Set(request.toolPolicy?.blockedPathPrefixes ?? [])].sort();
  // A keyed conversation follows its subject across assistants of the same
  // principal: the source's key already binds the principal, subject and
  // methods, and each run's own grants still decide which tools it may call.
  if (request.conversationKey) {
    const keyed = createHash("sha256").update(JSON.stringify({
      principal: request.contextScopeDigest, methods, blockedPaths, key: request.conversationKey,
    })).digest("hex");
    return `assistant-ctx-${keyed}`;
  }
  const scope = createHash("sha256").update(JSON.stringify({
    principal: request.contextScopeDigest,
    resource: { kind: request.definition.scope.kind, deviceId: request.definition.scope.deviceId ?? null },
    methods, grants: [...new Set(grants)].sort(),
    blockedPaths,
  })).digest("hex");
  // Connector and external owner are also part of the shared runtime's binding.
  // Goal, revision, trigger, run and attempt intentionally do not change it.
  return `assistant-${request.assistantId}-${scope}`;
}
