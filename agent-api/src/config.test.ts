import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("appConfig session cookies", () => {
  it("defaults secure cookies on outside development and test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/agent_studio");

    const { appConfig } = await import("./config.js");

    expect(appConfig.sessionCookie.secure).toBe(true);
  });

  it("keeps insecure cookies by default in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/agent_studio");

    const { appConfig } = await import("./config.js");

    expect(appConfig.sessionCookie.secure).toBe(false);
  });
});
