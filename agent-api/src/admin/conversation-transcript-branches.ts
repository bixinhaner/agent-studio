/**
 * The portal shows one branch of a thread: the path from the root to `headId`
 * (edits, regenerations and rejected sends live on other branches behind a
 * "1/2" picker). The admin transcript mirrors that so administrators read the
 * conversation in the same order as the user, while other versions stay
 * available as folded groups instead of being mixed into the main line.
 */
export type TranscriptBranchInfo = {
  /** On the path the user currently sees in the portal. */
  active: boolean;
  /** 1-based position among messages sharing the same parent (the portal's "1/2"). */
  siblingIndex: number;
  siblingCount: number;
  /**
   * For messages off the active path: the active-path message this alternate
   * version branches away from (same parent). Admin renders the folded group
   * right after it. Null on the active path or when no active sibling exists.
   */
  divergesFromId: string | null;
};

type BranchNode = { id: string; parentId: string | null };

function parentKey(parentId: string | null): string {
  return parentId ?? "\u0000root";
}

/**
 * Returns branch info per message id, or null when the graph cannot be resolved
 * (missing head, broken chain or cycle); callers then fall back to the flat list.
 */
export function computeTranscriptBranches(
  messages: BranchNode[],
  headId: string | null | undefined
): Map<string, TranscriptBranchInfo> | null {
  if (messages.length === 0) return new Map();
  const byId = new Map(messages.map((message) => [message.id, message] as const));
  const head = headId && byId.has(headId) ? headId : messages[messages.length - 1]!.id;

  const activeIds = new Set<string>();
  let cursor: string | null = head;
  while (cursor) {
    if (activeIds.has(cursor)) return null;
    const node = byId.get(cursor);
    if (!node) return null;
    activeIds.add(cursor);
    cursor = node.parentId;
  }

  const siblingsByParent = new Map<string, string[]>();
  for (const message of messages) {
    const key = parentKey(message.parentId);
    siblingsByParent.set(key, [...(siblingsByParent.get(key) ?? []), message.id]);
  }

  const info = new Map<string, TranscriptBranchInfo>();
  // Resolve off-path messages to the active message where their branch splits off.
  const divergence = (id: string): string | null => {
    let current = byId.get(id);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const parentActive = current.parentId === null || activeIds.has(current.parentId);
      if (parentActive) {
        const siblings = siblingsByParent.get(parentKey(current.parentId)) ?? [];
        return siblings.find((sibling) => activeIds.has(sibling)) ?? null;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return null;
  };

  for (const message of messages) {
    const siblings = siblingsByParent.get(parentKey(message.parentId)) ?? [message.id];
    const active = activeIds.has(message.id);
    info.set(message.id, {
      active,
      siblingIndex: siblings.indexOf(message.id) + 1,
      siblingCount: siblings.length,
      divergesFromId: active ? null : divergence(message.id)
    });
  }
  return info;
}

/** Children-based lookup used for per-branch turn status instead of list order. */
export function childrenByParent(messages: BranchNode[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const message of messages) {
    if (!message.parentId) continue;
    children.set(message.parentId, [...(children.get(message.parentId) ?? []), message.id]);
  }
  return children;
}
