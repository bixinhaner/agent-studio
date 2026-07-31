import { describe, expect, it } from "vitest";

import { filterStaleRuntimeThreadIds } from "./thread-running-state";

describe("thread running state", () => {
  it("removes runtime-only stale states after the server snapshot confirms completion", () => {
    expect(
      filterStaleRuntimeThreadIds(
        { stale: true, active: true, server: true },
        { active: true },
        { server: true }
      )
    ).toEqual({ active: true, server: true });
  });

  it("keeps the current local run visible before the server snapshot catches up", () => {
    expect(filterStaleRuntimeThreadIds({ thread: true }, { thread: true }, {})).toEqual({ thread: true });
  });
});
