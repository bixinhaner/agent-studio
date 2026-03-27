import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type SessionCookiePayload = {
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

export type SessionCookieManager = {
  cookieName: string;
  create(userId: string): string;
  clear(): string;
  read(header: string | string[] | undefined): SessionCookiePayload | undefined;
};

export type OAuthStatePayload = {
  state: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

export type OAuthStateCookieManager = {
  cookieName: string;
  issue(): { state: string; nonce: string; cookie: string };
  clear(): string;
  read(header: string | string[] | undefined): OAuthStatePayload | undefined;
};

type SameSiteValue = "lax" | "strict" | "none";

type CreateSessionCookieManagerOptions = {
  cookieName: string;
  secret: string;
  maxAgeMs: number;
  secure: boolean;
  sameSite?: SameSiteValue;
};

type CreateOAuthStateCookieManagerOptions = CreateSessionCookieManagerOptions;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function normalizeSameSite(value: SameSiteValue | undefined): "Lax" | "Strict" | "None" {
  if (value === "strict") return "Strict";
  if (value === "none") return "None";
  return "Lax";
}

function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const raw = Array.isArray(header) ? header.join("; ") : header ?? "";
  const entries = raw.split(";");
  const parsed = new Map<string, string>();
  for (const entry of entries) {
    const index = entry.indexOf("=");
    if (index <= 0) continue;
    const name = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (name) {
      parsed.set(name, value);
    }
  }
  return parsed;
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeMs: number; secure: boolean; sameSite: SameSiteValue }
): string {
  const maxAgeSeconds = Math.max(0, Math.floor(options.maxAgeMs / 1000));
  const expires = new Date(Date.now() + options.maxAgeMs).toUTCString();
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${normalizeSameSite(options.sameSite)}`,
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${expires}`
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function readSignedPayload<T extends Record<string, unknown>>(
  header: string | string[] | undefined,
  cookieName: string,
  secret: string
): T | undefined {
  if (!secret) {
    return undefined;
  }
  const rawValue = parseCookies(header).get(cookieName);
  const value = trimOrUndefined(rawValue);
  if (!value) return undefined;

  const dotIndex = value.lastIndexOf(".");
  if (dotIndex <= 0) return undefined;
  const payload = value.slice(0, dotIndex);
  const signature = value.slice(dotIndex + 1);
  const expectedSignature = sign(secret, payload);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return undefined;
  }

  try {
    return JSON.parse(fromBase64Url(payload)) as T;
  } catch {
    return undefined;
  }
}

export function createSessionCookieManager(
  options: CreateSessionCookieManagerOptions
): SessionCookieManager {
  const cookieName = trimOrUndefined(options.cookieName) ?? "agent_studio_session";
  const secret = trimOrUndefined(options.secret) ?? "";
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0 ? options.maxAgeMs : 7 * 24 * 60 * 60 * 1000;
  const sameSite = options.sameSite ?? "lax";

  return {
    cookieName,
    create(userId: string): string {
      const normalizedUserId = trimOrUndefined(userId);
      if (!normalizedUserId) {
        throw new Error("userId is required for session cookies");
      }
      if (!secret) {
        throw new Error("session cookie secret is not configured");
      }
      const now = Date.now();
      const encodedPayload = toBase64Url(
        JSON.stringify({
          userId: normalizedUserId,
          issuedAt: now,
          expiresAt: now + maxAgeMs
        } satisfies SessionCookiePayload)
      );
      const signature = sign(secret, encodedPayload);
      return serializeCookie(cookieName, `${encodedPayload}.${signature}`, {
        maxAgeMs,
        secure: options.secure,
        sameSite
      });
    },
    clear(): string {
      return serializeCookie(cookieName, "", {
        maxAgeMs: 0,
        secure: options.secure,
        sameSite
      });
    },
    read(header: string | string[] | undefined): SessionCookiePayload | undefined {
      const parsed = readSignedPayload<Partial<SessionCookiePayload>>(header, cookieName, secret);
      try {
        const userId = trimOrUndefined(parsed?.userId);
        const issuedAt = Number(parsed?.issuedAt);
        const expiresAt = Number(parsed?.expiresAt);
        if (!userId || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
          return undefined;
        }
        if (Date.now() >= expiresAt) {
          return undefined;
        }
        return { userId, issuedAt, expiresAt };
      } catch {
        return undefined;
      }
    }
  };
}

export function createOAuthStateCookieManager(
  options: CreateOAuthStateCookieManagerOptions
): OAuthStateCookieManager {
  const cookieName = trimOrUndefined(options.cookieName) ?? "agent_studio_oauth_state";
  const secret = trimOrUndefined(options.secret) ?? "";
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0 ? options.maxAgeMs : 10 * 60 * 1000;
  const sameSite = options.sameSite ?? "lax";

  return {
    cookieName,
    issue() {
      if (!secret) {
        throw new Error("oauth state cookie secret is not configured");
      }
      const now = Date.now();
      const payload: OAuthStatePayload = {
        state: randomUUID(),
        nonce: randomUUID(),
        issuedAt: now,
        expiresAt: now + maxAgeMs
      };
      const encodedPayload = toBase64Url(JSON.stringify(payload));
      const signature = sign(secret, encodedPayload);
      return {
        state: payload.state,
        nonce: payload.nonce,
        cookie: serializeCookie(cookieName, `${encodedPayload}.${signature}`, {
          maxAgeMs,
          secure: options.secure,
          sameSite
        })
      };
    },
    clear() {
      return serializeCookie(cookieName, "", {
        maxAgeMs: 0,
        secure: options.secure,
        sameSite
      });
    },
    read(header: string | string[] | undefined): OAuthStatePayload | undefined {
      const parsed = readSignedPayload<Partial<OAuthStatePayload>>(header, cookieName, secret);
      const state = trimOrUndefined(parsed?.state);
      const nonce = trimOrUndefined(parsed?.nonce);
      const issuedAt = Number(parsed?.issuedAt);
      const expiresAt = Number(parsed?.expiresAt);
      if (!state || !nonce || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
        return undefined;
      }
      if (Date.now() >= expiresAt) {
        return undefined;
      }
      return { state, nonce, issuedAt, expiresAt };
    }
  };
}
