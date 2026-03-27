export type ThreadListEntry = {
  id: string;
  external_id?: string;
  status?: string;
};

export type ResolveRunThreadIdInput = {
  unstableThreadId?: string;
  getActiveRemoteThreadId: () => string;
  getActiveLocalThreadId: () => string;
  listThreads: () => Promise<ThreadListEntry[]>;
  attempts?: number;
  waitMs?: number;
};

function trim(value: string | undefined): string {
  return String(value || "").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveRunThreadId(input: ResolveRunThreadIdInput): Promise<string | null> {
  const unstableThreadId = trim(input.unstableThreadId);
  if (unstableThreadId) {
    return unstableThreadId;
  }

  const maxAttempts = Math.max(1, input.attempts ?? 8);
  const waitMs = Math.max(0, input.waitMs ?? 80);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const activeLocalThreadId = trim(input.getActiveLocalThreadId());
    if (activeLocalThreadId) {
      const threads = await input.listThreads();
      const byExternal =
        (threads || []).find((thread) => trim(thread.external_id) === activeLocalThreadId && thread.status !== "archived") ||
        (threads || []).find((thread) => trim(thread.external_id) === activeLocalThreadId);
      if (byExternal?.id) {
        return trim(byExternal.id);
      }
    } else {
      const activeRemoteThreadId = trim(input.getActiveRemoteThreadId());
      if (activeRemoteThreadId) {
        return activeRemoteThreadId;
      }
    }
    if (attempt + 1 < maxAttempts) {
      await sleep(waitMs);
    }
  }

  return null;
}
