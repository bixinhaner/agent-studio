import { describe, expect, it } from "vitest";

import {
  CODEX_RUNTIME_ERROR_CODE,
  CodexRuntimeUserError,
  presentCodexRuntimeError
} from "./codex-runtime-user-error.js";

describe("Codex runtime user errors", () => {
  it("presents model capacity errors in Chinese", () => {
    const error = new CodexRuntimeUserError(CODEX_RUNTIME_ERROR_CODE.AI_SERVICE_BUSY);

    expect(presentCodexRuntimeError(error, "zh-CN,zh;q=0.9,en;q=0.8")).toEqual({
      code: "AI_SERVICE_BUSY",
      message: "AI 服务当前繁忙，请稍后再试。",
      retryable: true
    });
  });

  it("presents model capacity errors in English by default", () => {
    const error = new CodexRuntimeUserError(CODEX_RUNTIME_ERROR_CODE.AI_SERVICE_BUSY);

    expect(presentCodexRuntimeError(error, "en-US")).toEqual({
      code: "AI_SERVICE_BUSY",
      message: "The AI service is currently busy. Please try again later.",
      retryable: true
    });
    expect(presentCodexRuntimeError(error)).toEqual({
      code: "AI_SERVICE_BUSY",
      message: "The AI service is currently busy. Please try again later.",
      retryable: true
    });
  });

  it("does not rewrite unrelated errors", () => {
    expect(presentCodexRuntimeError(new Error("sandbox denied"), "zh-CN")).toBeUndefined();
  });
});
