import { describe, expect, it } from "vitest";

import { isSafariBrowser } from "./browser-compat";

describe("isSafariBrowser", () => {
  it("recognizes desktop Safari", () => {
    expect(
      isSafariBrowser({
        vendor: "Apple Computer, Inc.",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15"
      })
    ).toBe(true);
  });

  it("does not classify Chrome on macOS as Safari", () => {
    expect(
      isSafariBrowser({
        vendor: "Google Inc.",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
      })
    ).toBe(false);
  });

  it("excludes iOS browsers that use WebKit without being Safari", () => {
    expect(
      isSafariBrowser({
        vendor: "Apple Computer, Inc.",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/149.0.0.0 Mobile/15E148 Safari/604.1"
      })
    ).toBe(false);
  });

  it("is safe when navigator is unavailable", () => {
    expect(isSafariBrowser(undefined)).toBe(false);
  });
});
