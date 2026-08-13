export type RecoverableMessage = {
  id: string;
  externalId: string | null;
  role: string;
  parentId: string | null;
  position: number;
  createdAt: Date | string;
  updatedAt?: Date | string;
};

export type MessageGraphRecoveryPlan = {
  affected: boolean;
  reasons: Array<"missing_parent" | "cycle" | "duplicate_position" | "missing_head">;
  headId: string | null;
  messages: Array<RecoverableMessage & { nextParentId: string | null; nextPosition: number }>;
};

function normalized(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function timestamp(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roleOrder(role: string): number {
  if (role === "user") return 0;
  if (role === "assistant") return 1;
  return 2;
}

function orderedMessages(messages: RecoverableMessage[]): RecoverableMessage[] {
  const ordered = [...messages].sort((left, right) =>
    left.position - right.position ||
    timestamp(left.createdAt) - timestamp(right.createdAt) ||
    roleOrder(left.role) - roleOrder(right.role) ||
    left.id.localeCompare(right.id)
  );

  // Old concurrent writes could assign the assistant the lower position even
  // though its parent is the paired user message. Put that deterministic pair
  // back into conversational order before resequencing.
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const left = ordered[index];
    const right = ordered[index + 1];
    if (
      left.role === "assistant" &&
      right.role === "user" &&
      normalized(left.parentId) === normalized(right.externalId) &&
      normalized(right.parentId) === normalized(left.externalId)
    ) {
      ordered[index] = right;
      ordered[index + 1] = left;
      index += 1;
    }
  }
  return ordered;
}

function cycleFor(
  startId: string,
  parents: Map<string, string | null>,
  knownIds: Set<string>
): string[] {
  const path: string[] = [];
  const indices = new Map<string, number>();
  let cursor: string | null = startId;
  while (cursor && knownIds.has(cursor)) {
    const existingIndex = indices.get(cursor);
    if (existingIndex !== undefined) return path.slice(existingIndex);
    indices.set(cursor, path.length);
    path.push(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return [];
}

function nearestPrecedingId(input: {
  ordered: RecoverableMessage[];
  index: number;
  excluded: Set<string>;
  preferredRole?: "user" | "assistant";
}): string | null {
  for (let index = input.index - 1; index >= 0; index -= 1) {
    const candidate = input.ordered[index];
    const id = normalized(candidate.externalId);
    if (!id || input.excluded.has(id)) continue;
    if (input.preferredRole && candidate.role !== input.preferredRole) continue;
    return id;
  }
  if (input.preferredRole) {
    return nearestPrecedingId({ ...input, preferredRole: undefined });
  }
  return null;
}

export function planMessageGraphRecovery(input: {
  messages: RecoverableMessage[];
  headId?: string | null;
}): MessageGraphRecoveryPlan {
  const ordered = orderedMessages(input.messages);
  const knownIds = new Set(ordered.map((message) => normalized(message.externalId)).filter(Boolean) as string[]);
  const reasons = new Set<MessageGraphRecoveryPlan["reasons"][number]>();
  let topologyRepairStart: number | undefined;
  const positions = new Set<number>();
  for (const message of ordered) {
    if (positions.has(message.position)) reasons.add("duplicate_position");
    positions.add(message.position);
  }

  const parents = new Map<string, string | null>();
  for (const [index, message] of ordered.entries()) {
    const id = normalized(message.externalId);
    if (!id) continue;
    let parentId = normalized(message.parentId);
    if (parentId && !knownIds.has(parentId)) {
      reasons.add("missing_parent");
      topologyRepairStart = Math.min(topologyRepairStart ?? index, index);
      parentId = nearestPrecedingId({
        ordered,
        index,
        excluded: new Set([id]),
        preferredRole: message.role === "user" ? "assistant" : message.role === "assistant" ? "user" : undefined
      });
    }
    parents.set(id, parentId);
  }

  const repairedCycles = new Set<string>();
  for (const message of ordered) {
    const id = normalized(message.externalId);
    if (!id) continue;
    const cycle = cycleFor(id, parents, knownIds);
    const cycleKey = [...cycle].sort().join("\u0000");
    if (!cycle.length || repairedCycles.has(cycleKey)) continue;
    repairedCycles.add(cycleKey);
    reasons.add("cycle");
    const cycleIds = new Set(cycle);
    const userIndex = ordered.findIndex((candidate) => {
      const candidateId = normalized(candidate.externalId);
      return candidateId ? cycleIds.has(candidateId) && candidate.role === "user" : false;
    });
    const breakIndex = userIndex >= 0
      ? userIndex
      : ordered.findIndex((candidate) => cycleIds.has(normalized(candidate.externalId) ?? ""));
    const breakMessage = ordered[breakIndex];
    const breakId = normalized(breakMessage?.externalId);
    if (!breakId) continue;
    const earliestCycleIndex = Math.min(...cycle.map((cycleId) =>
      ordered.findIndex((candidate) => normalized(candidate.externalId) === cycleId)
    ).filter((index) => index >= 0));
    topologyRepairStart = Math.min(topologyRepairStart ?? earliestCycleIndex, earliestCycleIndex);
    parents.set(breakId, nearestPrecedingId({
      ordered,
      index: breakIndex,
      excluded: cycleIds,
      preferredRole: breakMessage.role === "user" ? "assistant" : breakMessage.role === "assistant" ? "user" : undefined
    }));
  }

  // Once a graph has broken, otherwise-valid later parent links can still form
  // sibling branches that assistant-ui will not render on the selected head.
  // Rebuild only the suffix from the first deterministic anomaly so every
  // recovered historical message is visible in its actual stored order.
  if (topologyRepairStart !== undefined) {
    for (let index = topologyRepairStart; index < ordered.length; index += 1) {
      const id = normalized(ordered[index]?.externalId);
      if (!id) continue;
      let previousId: string | null = null;
      for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
        previousId = normalized(ordered[previousIndex]?.externalId);
        if (previousId) break;
      }
      parents.set(id, previousId);
    }
  }

  const requestedHeadId = normalized(input.headId);
  if (requestedHeadId && !knownIds.has(requestedHeadId)) reasons.add("missing_head");
  const fallbackHeadId = [...ordered].reverse().map((message) => normalized(message.externalId)).find(Boolean) ?? null;
  const affected = reasons.size > 0;
  return {
    affected,
    reasons: [...reasons].sort(),
    headId: topologyRepairStart !== undefined
      ? fallbackHeadId
      : requestedHeadId && knownIds.has(requestedHeadId) ? requestedHeadId : fallbackHeadId,
    messages: ordered.map((message, index) => ({
      ...message,
      nextParentId: normalized(message.externalId) ? (parents.get(normalized(message.externalId)!) ?? null) : null,
      nextPosition: index
    }))
  };
}

export function assertRecoveredMessageGraph(plan: MessageGraphRecoveryPlan): void {
  const byId = new Map<string, { parentId: string | null }>();
  const positions = new Set<number>();
  for (const message of plan.messages) {
    if (positions.has(message.nextPosition)) throw new Error("Recovered message positions must be unique");
    positions.add(message.nextPosition);
    const id = normalized(message.externalId);
    if (id) byId.set(id, { parentId: message.nextParentId });
  }
  for (const [id, message] of byId) {
    if (message.parentId && !byId.has(message.parentId)) throw new Error("Recovered parent must exist");
    if (cycleFor(id, new Map([...byId].map(([key, value]) => [key, value.parentId])), new Set(byId.keys())).length) {
      throw new Error("Recovered message graph must be acyclic");
    }
  }
  if (plan.headId && !byId.has(plan.headId)) throw new Error("Recovered head must exist");
}

export function planMessageGraphSuffixRebuild(input: {
  messages: RecoverableMessage[];
  headId?: string | null;
  startExternalId: string;
}): MessageGraphRecoveryPlan {
  const ordered = orderedMessages(input.messages);
  const startIndex = ordered.findIndex((message) => normalized(message.externalId) === normalized(input.startExternalId));
  if (startIndex < 0) throw new Error("Suffix rebuild start message no longer exists");
  const parents = new Map<string, string | null>();
  for (const message of ordered) {
    const id = normalized(message.externalId);
    if (id) parents.set(id, normalized(message.parentId));
  }
  for (let index = startIndex; index < ordered.length; index += 1) {
    const id = normalized(ordered[index]?.externalId);
    if (!id) continue;
    let previousId: string | null = null;
    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      previousId = normalized(ordered[previousIndex]?.externalId);
      if (previousId) break;
    }
    parents.set(id, previousId);
  }
  const fallbackHeadId = [...ordered].reverse().map((message) => normalized(message.externalId)).find(Boolean) ?? null;
  return {
    affected: true,
    reasons: ["missing_parent"],
    headId: fallbackHeadId,
    messages: ordered.map((message, index) => ({
      ...message,
      nextParentId: normalized(message.externalId) ? (parents.get(normalized(message.externalId)!) ?? null) : null,
      nextPosition: index
    }))
  };
}

export function messageGraphSnapshotSignature(messages: RecoverableMessage[]): string {
  return messages
    .map((message) => [
      message.id,
      message.externalId ?? "",
      message.parentId ?? "",
      message.position,
      timestamp(message.updatedAt ?? message.createdAt)
    ].join("\u0001"))
    .sort()
    .join("\u0002");
}
