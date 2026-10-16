import { asRecord } from "./portal-value-utils";
import { type RunningThreadIdsContextValue } from "./portal-types";

export function isThreadRuntimeRunning(value: unknown): boolean {
  const runtime = asRecord(value);
  if (runtime?.isRunning === true) return true;
  const messages = Array.isArray(runtime?.messages) ? runtime.messages : [];
  const lastMessage = messages[messages.length - 1];
  const message = asRecord(lastMessage);
  const status = asRecord(message?.status);
  return message?.role === "assistant" && status?.type === "running";
}

export function areRunningThreadMapsEqual(
  left: RunningThreadIdsContextValue,
  right: RunningThreadIdsContextValue
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

export function updateRunningThreadMap(
  current: RunningThreadIdsContextValue,
  threadId: string,
  isRunning: boolean
): RunningThreadIdsContextValue {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return current;

  if (isRunning) {
    return current[normalizedThreadId] ? current : { ...current, [normalizedThreadId]: true };
  }

  if (!current[normalizedThreadId]) return current;
  const next = { ...current };
  delete next[normalizedThreadId];
  return next;
}

export function normalizeThreadIdentityKeys(...threadIds: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of threadIds) {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function updateRunningThreadMapForKeys(
  current: RunningThreadIdsContextValue,
  threadIds: readonly string[],
  isRunning: boolean
): RunningThreadIdsContextValue {
  let next = current;
  for (const threadId of threadIds) {
    next = updateRunningThreadMap(next, threadId, isRunning);
  }
  return next;
}

export function mergeRunningThreadMaps(
  ...maps: RunningThreadIdsContextValue[]
): RunningThreadIdsContextValue {
  return maps.reduce<RunningThreadIdsContextValue>((merged, current) => {
    if (Object.keys(current).length === 0) return merged;
    return { ...merged, ...current };
  }, {});
}
