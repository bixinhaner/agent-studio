// Archived ("deleted") portal tasks stay restorable from the trash for this long; afterwards the
// daily purge job (ops/purge-archived-thread-data.ts) removes their files and Codex rollouts and
// the trash stops listing them. Thread rows and messages stay for audit and usage history.
export const ARCHIVED_THREAD_RETENTION_DAYS = 7;

export function archivedThreadDeleteAt(archivedAt: Date | string): string {
  const base = new Date(archivedAt).getTime();
  return new Date(base + ARCHIVED_THREAD_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
