import { describe, expect, it } from "vitest";

import { extractTranscriptTurnOutcome } from "./conversation-transcript-outcome.js";

function audit(data: Record<string, unknown>) {
  return { type: "data", name: "codex_process_audit", data };
}

describe("extractTranscriptTurnOutcome", () => {
  it("returns null for completed messages", () => {
    expect(extractTranscriptTurnOutcome({ role: "assistant", status: { type: "complete" }, content: [] })).toBeNull();
  });

  it("distinguishes user stops from auto-closed dangling turns", () => {
    const stopped = extractTranscriptTurnOutcome({
      status: { type: "incomplete", reason: "cancelled" },
      content: [audit({ kind: "cancelled", reason: "explicit_cancel" })],
      metadata: { custom: { stopped: true, stopReason: "explicit_cancel" } }
    });
    expect(stopped).toMatchObject({ kind: "user_stopped", rawDetail: "explicit_cancel" });
    const closed = extractTranscriptTurnOutcome({
      status: { type: "incomplete", reason: "cancelled" },
      content: [],
      metadata: { custom: { stopped: true, stopReason: "dangling_user_head" } }
    });
    expect(closed?.kind).toBe("auto_closed");
  });

  it("classifies failures by recorded code and keeps the raw detail", () => {
    const failed = (data: Record<string, unknown>, custom: Record<string, unknown> = {}) => extractTranscriptTurnOutcome({
      status: { type: "incomplete", reason: "error" },
      content: [audit({ kind: "error", ...data })],
      metadata: { custom: { failed: true, ...custom } }
    });
    expect(failed({ code: "DEPLOYMENT_DRAIN", rawDetail: "draining" })).toMatchObject({ kind: "deployment_drain", rawDetail: "draining" });
    expect(failed({ code: "AI_SERVICE_BUSY" })?.kind).toBe("ai_service_busy");
    expect(failed({ rawDetail: "turn idle timed out" })).toMatchObject({ kind: "runtime_error", rawDetail: "turn idle timed out" });
    expect(failed({}, { autoRecoveryAttempted: true })).toMatchObject({ kind: "auto_recovery_exhausted", autoRecoveryAttempted: true });
  });

  it("falls back to status.error when no audit part exists", () => {
    expect(extractTranscriptTurnOutcome({
      status: { type: "incomplete", reason: "error", error: "portal_auto_recovery_exhausted" },
      content: []
    })).toMatchObject({ kind: "auto_recovery_exhausted", rawDetail: "portal_auto_recovery_exhausted" });
  });
});
