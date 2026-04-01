function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDateValue(value: unknown): value is Date {
  return value instanceof Date;
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (isDateValue(left) || isDateValue(right)) {
    if (!isDateValue(left) || !isDateValue(right)) return false;
    return left.getTime() === right.getTime();
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) return false;
    }
    return true;
  }

  if (isObjectLike(left) || isObjectLike(right)) {
    if (!isObjectLike(left) || !isObjectLike(right)) return false;

    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;

    for (let index = 0; index < leftKeys.length; index += 1) {
      if (leftKeys[index] !== rightKeys[index]) return false;
    }

    for (const key of leftKeys) {
      if (!deepEqual(left[key], right[key])) return false;
    }
    return true;
  }

  return false;
}

export function trimString(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  return value;
}

export function normalizeRecordForCompare<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRecordForCompare(item)) as T;
  }
  if (isObjectLike(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, normalizeRecordForCompare(trimString(item))]);
    return Object.fromEntries(entries) as T;
  }
  return trimString(value) as T;
}
