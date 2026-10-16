/**
 * Arrow-key movement for a wrapped grid of buttons (roving focus). Only one item
 * is in the Tab order; arrows move between items so a keyboard user can cross a
 * long grid without tabbing through every card.
 */
export type RovingGridKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

const ROVING_KEYS = new Set<string>(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

export function isRovingGridKey(key: string): key is RovingGridKey {
  return ROVING_KEYS.has(key);
}

/**
 * Returns the index to focus, `"before"` when ArrowUp leaves the first row (the
 * caller usually returns focus to a search field), or `null` when nothing moves.
 */
export function nextRovingGridIndex(input: {
  current: number;
  count: number;
  columns: number;
  key: RovingGridKey;
  rtl?: boolean;
}): number | "before" | null {
  const { current, count, key } = input;
  if (count <= 0 || current < 0 || current >= count) return null;
  const columns = Math.max(1, Math.floor(input.columns));
  const forward = input.rtl ? "ArrowLeft" : "ArrowRight";
  const backward = input.rtl ? "ArrowRight" : "ArrowLeft";
  let next = current;
  if (key === forward) next = current + 1;
  else if (key === backward) next = current - 1;
  else if (key === "ArrowDown") next = current + columns;
  else if (key === "ArrowUp") {
    if (current - columns < 0) return "before";
    next = current - columns;
  } else if (key === "Home") next = 0;
  else if (key === "End") next = count - 1;
  if (key === "ArrowDown" && next >= count) {
    // From a partial last row, ArrowDown lands on the final item instead of doing nothing.
    next = Math.floor(current / columns) === Math.floor((count - 1) / columns) ? current : count - 1;
  }
  if (next < 0 || next >= count) return null;
  return next === current ? null : next;
}

/** Number of items laid out on the first visual row of a wrapped grid. */
export function measureGridColumns(items: ReadonlyArray<Pick<HTMLElement, "offsetTop">>): number {
  if (items.length === 0) return 1;
  const firstTop = items[0].offsetTop;
  let columns = 0;
  for (const item of items) {
    if (Math.abs(item.offsetTop - firstTop) > 2) break;
    columns += 1;
  }
  return Math.max(1, columns);
}
