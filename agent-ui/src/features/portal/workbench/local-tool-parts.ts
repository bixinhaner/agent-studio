type Part = Record<string, any>;

export function isLocalToolPart(part: Part): boolean {
  return part.type === 'tool-call' && typeof part.toolName === 'string' && part.toolName.startsWith('local_computer.');
}

// Keep local results in the message itself so normal users can open generated files.
export function upsertLocalToolParts(content: Part[], updates: Part[]): boolean {
  let changed = false;
  for (const part of updates) {
    if (!isLocalToolPart(part)) continue;
    const index = content.findIndex(item => isLocalToolPart(item) && item.toolCallId === part.toolCallId);
    if (index >= 0) {
      if (content[index].result !== undefined && part.result === undefined) continue;
      content[index] = part;
    } else content.push(part);
    changed = true;
  }
  return changed;
}
