import { describe, expect, it } from "vitest";

import { isRovingGridKey, measureGridColumns, nextRovingGridIndex } from "./roving-focus";

describe("nextRovingGridIndex", () => {
  const grid = (current: number, key: Parameters<typeof nextRovingGridIndex>[0]["key"], rtl = false) =>
    nextRovingGridIndex({ current, count: 7, columns: 3, key, rtl });

  it("moves along a row and between rows", () => {
    expect(grid(0, "ArrowRight")).toBe(1);
    expect(grid(4, "ArrowLeft")).toBe(3);
    expect(grid(1, "ArrowDown")).toBe(4);
    expect(grid(4, "ArrowUp")).toBe(1);
  });

  it("leaves the grid upward from the first row so focus can return to search", () => {
    expect(grid(2, "ArrowUp")).toBe("before");
  });

  it("does not move past either end", () => {
    expect(grid(0, "ArrowLeft")).toBeNull();
    expect(grid(6, "ArrowRight")).toBeNull();
    expect(grid(6, "ArrowDown")).toBeNull();
  });

  it("lands on the last item when the row below is partial", () => {
    expect(grid(5, "ArrowDown")).toBe(6);
  });

  it("jumps with Home and End", () => {
    expect(grid(4, "Home")).toBe(0);
    expect(grid(1, "End")).toBe(6);
  });

  it("mirrors horizontal arrows for right-to-left layouts", () => {
    expect(grid(1, "ArrowLeft", true)).toBe(2);
    expect(grid(1, "ArrowRight", true)).toBe(0);
  });

  it("ignores out-of-range positions", () => {
    expect(nextRovingGridIndex({ current: 3, count: 0, columns: 2, key: "ArrowDown" })).toBeNull();
    expect(nextRovingGridIndex({ current: -1, count: 4, columns: 2, key: "ArrowDown" })).toBeNull();
  });
});

describe("measureGridColumns", () => {
  it("counts items sharing the first row", () => {
    expect(measureGridColumns([{ offsetTop: 0 }, { offsetTop: 1 }, { offsetTop: 120 }, { offsetTop: 120 }])).toBe(2);
  });

  it("falls back to one column", () => {
    expect(measureGridColumns([])).toBe(1);
  });
});

describe("isRovingGridKey", () => {
  it("accepts navigation keys only", () => {
    expect(isRovingGridKey("ArrowDown")).toBe(true);
    expect(isRovingGridKey("Enter")).toBe(false);
  });
});
