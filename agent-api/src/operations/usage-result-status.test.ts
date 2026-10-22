import { describe, expect, it } from "vitest";

import { isUsageFailure, usageResultStatusForTurn } from "./usage-result-status.js";

describe("usageResultStatusForTurn", () => {
  it("marks a failed turn as cancelled only after the user's explicit stop", () => {
    const userStop = new AbortController();
    expect(usageResultStatusForTurn("failed", userStop.signal)).toBe("failed");
    expect(usageResultStatusForTurn("failed", undefined)).toBe("failed");
    userStop.abort();
    expect(usageResultStatusForTurn("failed", userStop.signal)).toBe("cancelled");
    expect(usageResultStatusForTurn("success", userStop.signal)).toBe("success");
  });
});

describe("isUsageFailure", () => {
  it("excludes successes and user cancellations", () => {
    expect(isUsageFailure("success")).toBe(false);
    expect(isUsageFailure("cancelled")).toBe(false);
    expect(isUsageFailure("failed")).toBe(true);
    expect(isUsageFailure("denied")).toBe(true);
  });
});
