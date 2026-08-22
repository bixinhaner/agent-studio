export const POSTGRES_JSON_NUL_REPLACEMENT = "\\u0000";

export type SanitizedPostgresJson<T> = {
  value: T;
  replacementCount: number;
};

type SanitizeResult = {
  value: unknown;
  replacementCount: number;
};

function sanitizeString(value: string): SanitizeResult {
  if (!value.includes("\u0000")) return { value, replacementCount: 0 };
  const parts = value.split("\u0000");
  return {
    value: parts.join(POSTGRES_JSON_NUL_REPLACEMENT),
    replacementCount: parts.length - 1
  };
}

function uniqueObjectKey(key: string, target: Record<string, unknown>): string {
  if (!Object.prototype.hasOwnProperty.call(target, key)) return key;
  let suffix = 2;
  while (Object.prototype.hasOwnProperty.call(target, `${key}#${suffix}`)) suffix += 1;
  return `${key}#${suffix}`;
}

function sanitizeValue(value: unknown, ancestors: WeakSet<object>): SanitizeResult {
  if (typeof value === "string") return sanitizeString(value);
  if (!value || typeof value !== "object") return { value, replacementCount: 0 };

  if (ancestors.has(value)) {
    throw new Error("Conversation JSON cannot contain cyclic references");
  }

  if (Array.isArray(value)) {
    ancestors.add(value);
    let replacementCount = 0;
    let sanitized: unknown[] | undefined;
    for (let index = 0; index < value.length; index += 1) {
      const result = sanitizeValue(value[index], ancestors);
      replacementCount += result.replacementCount;
      if (result.value !== value[index]) {
        sanitized ??= value.slice();
        sanitized[index] = result.value;
      }
    }
    ancestors.delete(value);
    return { value: sanitized ?? value, replacementCount };
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return { value, replacementCount: 0 };
  }

  ancestors.add(value);
  const source = value as Record<string, unknown>;
  let replacementCount = 0;
  let sanitized: Record<string, unknown> | undefined;
  const originalKeys = Object.keys(source);
  for (let index = 0; index < originalKeys.length; index += 1) {
    const originalKey = originalKeys[index];
    const originalValue = source[originalKey];
    const keyResult = sanitizeString(originalKey);
    const valueResult = sanitizeValue(originalValue, ancestors);
    replacementCount += keyResult.replacementCount + valueResult.replacementCount;
    const requestedKey = keyResult.value as string;
    if (!sanitized && (requestedKey !== originalKey || valueResult.value !== originalValue)) {
      sanitized = Object.create(prototype) as Record<string, unknown>;
      for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
        const previousKey = originalKeys[previousIndex];
        sanitized[previousKey] = source[previousKey];
      }
    }
    if (sanitized) {
      sanitized[uniqueObjectKey(requestedKey, sanitized)] = valueResult.value;
    }
  }
  ancestors.delete(value);
  return { value: sanitized ?? value, replacementCount };
}

export function sanitizeJsonForPostgres<T>(value: T): SanitizedPostgresJson<T> {
  const result = sanitizeValue(value, new WeakSet());
  return {
    value: result.value as T,
    replacementCount: result.replacementCount
  };
}
