import { describe, expect, it } from "vitest";

import { integrationInstanceUpdateSchema } from "./types.js";

// Integration config rejects secret-looking keys (anything containing "token", "secret", ...). The provider
// tuning keys the admin form saves must not trip that check, or saving the DeepSeek provider fails.
describe("OpenAI/Codex provider config keys", () => {
  it("accepts the display-name and auto-compact keys", () => {
    const parsed = integrationInstanceUpdateSchema.safeParse({
      config: {
        providerKind: "openai_api",
        baseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-flash",
        modelDisplayNames: { "deepseek-flash": "DeepSeek-V4.1-Flash-1017" },
        autoCompactThreshold: 400_000
      }
    });
    expect(parsed.success).toBe(true);
  });
});
