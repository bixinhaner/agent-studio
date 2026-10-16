/**
 * Postgres jsonb cannot store U+0000 or unpaired surrogates. A local read of a file
 * with NUL bytes (UTF-16 text, binary data) or a command printing them produced such
 * results; the insert failed, and the desktop client retried that one result forever
 * without taking new work, so the whole local connection stalled.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const NUL_REMOVED_NOTE =
  'The result contained NUL characters (binary data or UTF-16 text), which were removed. For the exact bytes, read the file again with encoding "base64".';

function clean(value: unknown, state: { changed: boolean }): unknown {
  if (typeof value === 'string') {
    const next = value.replace(/\u0000/g, '').replace(LONE_SURROGATE, '�');
    if (next !== value) state.changed = true;
    return next;
  }
  if (Array.isArray(value)) return value.map(item => clean(item, state));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [clean(key, state) as string, clean(item, state)]));
  }
  return value;
}

/** A copy of the result that Postgres jsonb accepts, with a note for the agent when text was removed. */
export function storableLocalResult(result: Record<string, unknown>): Record<string, unknown> {
  const state = { changed: false };
  const cleaned = clean(result, state) as Record<string, unknown>;
  return state.changed ? { ...cleaned, warning: NUL_REMOVED_NOTE } : cleaned;
}
