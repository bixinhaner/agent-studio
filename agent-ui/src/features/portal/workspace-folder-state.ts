export function expandWorkspaceFolderIds(
  directFolderIds: ReadonlySet<string>,
  ancestorPaths: Readonly<Record<string, readonly string[]>>
): Set<string> {
  const expanded = new Set<string>(directFolderIds);
  for (const folderId of directFolderIds) {
    for (const ancestorId of ancestorPaths[folderId] || []) {
      const normalized = String(ancestorId || "").trim();
      if (normalized) expanded.add(normalized);
    }
  }
  return expanded;
}
