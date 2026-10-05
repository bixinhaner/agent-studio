import { describe, expect, it } from "vitest";

import { deliveryRecipientLabel } from "./BroadcastAdminView";

describe("deliveryRecipientLabel", () => {
  it("prefers the recipient email from the payload", () => {
    expect(deliveryRecipientLabel({ channelType: "email", eventType: "broadcast.email", payload: { email: "a@b.test" } })).toBe("a@b.test");
    expect(deliveryRecipientLabel({ channelType: "email", eventType: "broadcast.test_email", payload: { testEmail: "t@b.test" } })).toBe("t@b.test");
  });

  it("falls back to channel descriptions", () => {
    expect(deliveryRecipientLabel({ channelType: "in_app", eventType: "broadcast.published", payload: {} })).toBe("目标用户");
    expect(deliveryRecipientLabel({ channelType: "dingtalk", eventType: "x", payload: null })).toBe("钉钉");
  });
});
