import { describe, expect, it, vi } from "vitest";

import { createBrandAwareEmailSender, type AuthEmailSender } from "./email.js";

describe("createBrandAwareEmailSender", () => {
  it("uses the shared sender when a brand has no dedicated SMTP transport", async () => {
    const send = vi.fn(async () => ({ delivered: true, mode: "smtp" as const }));
    const fallback: AuthEmailSender = { send };
    const sender = createBrandAwareEmailSender(fallback, vi.fn(async () => undefined));

    await sender.send({ publicBrandId: "brand-bailey", to: "customer@example.com", subject: "Shared", text: "Body" });

    expect(send).toHaveBeenCalledOnce();
  });

  it("does not use the shared sender when a dedicated transport is configured", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const send = vi.fn(async () => ({ delivered: true, mode: "smtp" as const }));
    const fallback: AuthEmailSender = { send };
    const sender = createBrandAwareEmailSender(fallback, vi.fn(async () => ({ from: "sender@example.com" })));

    await expect(sender.send({ publicBrandId: "brand-ranley", to: "customer@example.com", subject: "Dedicated", text: "Body" }))
      .resolves.toEqual({ delivered: false, mode: "debug" });
    expect(send).not.toHaveBeenCalled();
  });
});
