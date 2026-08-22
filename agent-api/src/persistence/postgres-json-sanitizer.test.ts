import { describe, expect, it } from "vitest";

import { POSTGRES_JSON_NUL_REPLACEMENT, sanitizeJsonForPostgres } from "./postgres-json-sanitizer.js";

describe("sanitizeJsonForPostgres", () => {
  it("recursively preserves NUL positions as visible text without mutating the source", () => {
    const source = {
      content: [
        { type: "text", text: "answer\u0000continues" },
        { type: "tool-result", data: { stdout: "first\u0000second\u0000third" } }
      ],
      runConfig: { "tool\u0000name": "log\u0000analysis" }
    };

    const result = sanitizeJsonForPostgres(source);

    expect(result.replacementCount).toBe(5);
    expect(result.value).toEqual({
      content: [
        { type: "text", text: `answer${POSTGRES_JSON_NUL_REPLACEMENT}continues` },
        {
          type: "tool-result",
          data: { stdout: `first${POSTGRES_JSON_NUL_REPLACEMENT}second${POSTGRES_JSON_NUL_REPLACEMENT}third` }
        }
      ],
      runConfig: { [`tool${POSTGRES_JSON_NUL_REPLACEMENT}name`]: `log${POSTGRES_JSON_NUL_REPLACEMENT}analysis` }
    });
    expect(source.content[0].text).toBe("answer\u0000continues");
    expect(Object.keys(source.runConfig)).toEqual(["tool\u0000name"]);
  });

  it("returns the original references when normal Unicode content is already safe", () => {
    const source = {
      text: "正常换行\nEspañol 😀",
      nested: [{ value: "unchanged" }]
    };

    const result = sanitizeJsonForPostgres(source);

    expect(result.replacementCount).toBe(0);
    expect(result.value).toBe(source);
    expect(result.value.nested).toBe(source.nested);
  });

  it("keeps colliding escaped object keys instead of dropping data", () => {
    const source = {
      "field\u0000name": "from-nul-key",
      "field\\u0000name": "from-literal-key"
    };

    const result = sanitizeJsonForPostgres(source);

    expect(result.value).toEqual({
      "field\\u0000name": "from-nul-key",
      "field\\u0000name#2": "from-literal-key"
    });
  });

  it("rejects cyclic values with an actionable error", () => {
    const source: Record<string, unknown> = {};
    source.self = source;

    expect(() => sanitizeJsonForPostgres(source)).toThrow("cannot contain cyclic references");
  });
});
