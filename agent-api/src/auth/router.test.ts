import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createCurrentUserMiddleware } from "./current-user.js";
import { createAuthRouter } from "./router.js";
import { createOAuthStateCookieManager, createSessionCookieManager } from "./session-cookie.js";
import type {
  AuthenticatedUser,
  DingTalkUserIdentity,
  UserRepositoryLike
} from "../persistence/user-repository.js";

class FakeUserRepository implements UserRepositoryLike {
  private counter = 0;
  private readonly users = new Map<string, AuthenticatedUser>();

  async getById(id: string): Promise<AuthenticatedUser | undefined> {
    return this.users.get(id);
  }

  async getByExternalId(externalId: string): Promise<AuthenticatedUser | undefined> {
    for (const user of this.users.values()) {
      if (user.externalId === externalId) {
        return user;
      }
    }
    return undefined;
  }

  async upsertFromDingTalk(identity: DingTalkUserIdentity): Promise<AuthenticatedUser> {
    const existing = await this.getByExternalId(identity.unionId);
    const next: AuthenticatedUser = {
      id: existing?.id ?? `user-${++this.counter}`,
      externalId: identity.unionId,
      email: identity.email,
      displayName: identity.displayName,
      role: existing?.role ?? "employee",
      status: existing?.status ?? "active",
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.users.set(next.id, next);
    return next;
  }
}

function buildApp(options?: {
  users?: FakeUserRepository;
  dingtalkClient?: { exchangeCode(code: string): Promise<DingTalkUserIdentity> };
  dingtalkConfig?: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    scope?: string;
  };
}) {
  const users = options?.users ?? new FakeUserRepository();
  const cookies = createSessionCookieManager({
    cookieName: "agent_studio_session",
    secret: "test-session-secret",
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    secure: false,
    sameSite: "lax"
  });
  const oauthStates = createOAuthStateCookieManager({
    cookieName: "agent_studio_oauth_state",
    secret: "test-session-secret",
    maxAgeMs: 10 * 60 * 1000,
    secure: false,
    sameSite: "lax"
  });
  const app = express();
  app.use(express.json());
  app.use(createCurrentUserMiddleware({ users, cookies }));
  app.use(
    "/api/auth",
    createAuthRouter({
      users,
      cookies,
      dingtalkClient:
        options?.dingtalkClient ?? {
          async exchangeCode() {
            throw new Error("unexpected exchangeCode call");
          }
        },
      dingtalkConfig: {
        clientId: options?.dingtalkConfig?.clientId ?? "ding-client-id",
        clientSecret: options?.dingtalkConfig?.clientSecret ?? "ding-client-secret",
        redirectUri:
          options?.dingtalkConfig?.redirectUri ?? "https://agent.example.com/auth/dingtalk/callback",
        scope: options?.dingtalkConfig?.scope ?? "openid"
      },
      oauthStates,
      sessionCookieReady: true
    })
  );
  return { app, cookies, oauthStates, users };
}

describe("auth router", () => {
  it("returns 401 from whoami without a session cookie", async () => {
    const { app } = buildApp();

    const response = await request(app).get("/api/auth/whoami");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "Unauthorized" });
  });

  it("rejects whoami for an inactive user even with a valid session cookie", async () => {
    const { app, cookies, users } = buildApp();
    const user = await users.upsertFromDingTalk({
      unionId: "ding-user-inactive",
      email: "inactive@example.com",
      displayName: "Inactive Agent"
    });
    user.status = "disabled";

    const response = await request(app)
      .get("/api/auth/whoami")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "Unauthorized" });
  });

  it("clears the session cookie on logout", async () => {
    const { app, cookies, users } = buildApp();
    const user = await users.upsertFromDingTalk({
      unionId: "ding-user-1",
      email: "agent@example.com",
      displayName: "Agent One"
    });

    const response = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(204);
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(response.headers["set-cookie"][0]).toContain("agent_studio_session=");
    expect(response.headers["set-cookie"][0]).toContain("Max-Age=0");
  });

  it("validates required DingTalk config before exposing public auth config", async () => {
    const { app } = buildApp({
      dingtalkConfig: {
        clientId: "ding-client-id",
        clientSecret: "",
        redirectUri: "https://agent.example.com/auth/dingtalk/callback"
      }
    });

    const response = await request(app).get("/api/auth/dingtalk/config");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      detail: "DingTalk auth is not configured",
      missing: ["client_secret"]
    });
  });

  it("returns public DingTalk config plus a server-issued state and nonce", async () => {
    const { app } = buildApp();

    const response = await request(app).get("/api/auth/dingtalk/config");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      config: {
        client_id: "ding-client-id",
        redirect_uri: "https://agent.example.com/auth/dingtalk/callback",
        response_type: "code",
        scope: "openid",
        state: expect.any(String),
        nonce: expect.any(String)
      }
    });
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(response.headers["set-cookie"][0]).toContain("agent_studio_oauth_state=");
  });

  it("rejects DingTalk login when the server-issued state does not match", async () => {
    const { app } = buildApp({
      dingtalkClient: {
        async exchangeCode() {
          throw new Error("exchangeCode should not run for invalid state");
        }
      }
    });

    const config = await request(app).get("/api/auth/dingtalk/config");
    const response = await request(app)
      .post("/api/auth/dingtalk/session")
      .set("Cookie", config.headers["set-cookie"])
      .send({
        code: "temporary-auth-code",
        state: "wrong-state",
        nonce: config.body.config.nonce
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "Invalid OAuth state" });
  });

  it("creates a session cookie from DingTalk code exchange and serves whoami from the persisted user", async () => {
    const { app } = buildApp({
      dingtalkClient: {
        async exchangeCode(code: string) {
          expect(code).toBe("temporary-auth-code");
          return {
            unionId: "ding-user-99",
            email: "agent99@example.com",
            displayName: "Agent 99"
          };
        }
      }
    });

    const config = await request(app).get("/api/auth/dingtalk/config");
    const login = await request(app)
      .post("/api/auth/dingtalk/session")
      .set("Cookie", config.headers["set-cookie"])
      .send({
        code: "temporary-auth-code",
        state: config.body.config.state,
        nonce: config.body.config.nonce
      });

    expect(login.status).toBe(200);
    expect(login.body).toEqual({
      user: {
        id: expect.any(String),
        external_id: "ding-user-99",
        email: "agent99@example.com",
        display_name: "Agent 99",
        role: "employee",
        status: "active"
      }
    });
    expect(login.headers["set-cookie"]).toBeDefined();

    const whoami = await request(app)
      .get("/api/auth/whoami")
      .set("Cookie", login.headers["set-cookie"]);

    expect(whoami.status).toBe(200);
    expect(whoami.body).toEqual(login.body);
  });
});
