import { describe, expect, it } from "vitest";

import { PORTAL_ANTD_THEME } from "./theme";

describe("portal antd theme", () => {
  it("defines required neutral + primary tokens", () => {
    expect(PORTAL_ANTD_THEME.token?.colorPrimary).toBe("#2563EB");
    expect(PORTAL_ANTD_THEME.token?.colorBgLayout).toBe("#F8FAFC");
    expect(PORTAL_ANTD_THEME.token?.borderRadius).toBe(10);
  });
});

