import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { PrismaClient } from "@prisma/client";

const scrypt = promisify(scryptCallback);
const MAX_FAILURES = 5;
const BLOCK_MS = 5 * 60 * 1000;

type AccessPolicy = { organizationId: string; passwordDigest: string; passwordVersion: number };
type AccessDb = Pick<PrismaClient, "securityDomainAccessPolicy">;
type GrantPayload = { organizationId: string; userId: string; passwordVersion: number; expiresAt: number };

export class SecurityDomainAccessError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "SecurityDomainAccessError";
  }
}

function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const raw = Array.isArray(header) ? header.join("; ") : header ?? "";
  return new Map(
    raw.split(";").flatMap((entry) => {
      const index = entry.indexOf("=");
      return index > 0 ? [[entry.slice(0, index).trim(), entry.slice(index + 1).trim()]] : [];
    })
  );
}

async function passwordDigest(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt:${salt}:${derived.toString("base64url")}`;
}

async function passwordMatches(password: string, digest: string): Promise<boolean> {
  const [algorithm, salt, expectedText] = digest.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedText) return false;
  const expected = Buffer.from(expectedText, "base64url");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class SecurityDomainAccessControl {
  private readonly failures = new Map<string, { count: number; blockedUntil: number }>();

  constructor(
    private readonly db: AccessDb,
    private readonly options: { cookieName: string; secret: string; secure: boolean; grantTtlMs?: number }
  ) {}

  async status(input: { organizationId: string; userId: string; role: string; cookie?: string | string[] }) {
    const policy = await this.policy(input.organizationId);
    return {
      configured: Boolean(policy),
      unlocked: policy ? this.readGrant(input.cookie, policy, input.userId) : false,
      canInitialize: !policy && input.role === "super_admin",
      expiresInMinutes: Math.round(this.grantTtlMs() / 60_000)
    };
  }

  async initialize(input: { organizationId: string; userId: string; role: string; password: string }): Promise<string> {
    this.ensureReady();
    if (input.role !== "super_admin") {
      throw new SecurityDomainAccessError("仅超级管理员可以首次设置保密域密码", 403, "initialization_forbidden");
    }
    this.validatePassword(input.password);
    const existing = await this.policy(input.organizationId);
    if (existing) throw new SecurityDomainAccessError("保密域密码已经设置", 409, "already_configured");
    const policy = await this.db.securityDomainAccessPolicy.create({
      data: {
        organizationId: input.organizationId,
        passwordDigest: await passwordDigest(input.password),
        updatedByUserId: input.userId
      }
    });
    return this.createGrant(policy, input.userId);
  }

  async unlock(input: { organizationId: string; userId: string; password: string }): Promise<string> {
    this.ensureReady();
    const policy = await this.policy(input.organizationId);
    if (!policy) throw new SecurityDomainAccessError("保密域密码尚未设置", 409, "not_configured");
    const key = `${input.organizationId}:${input.userId}`;
    const failed = this.failures.get(key);
    if (failed && failed.blockedUntil > Date.now()) {
      throw new SecurityDomainAccessError("密码错误次数过多，请 5 分钟后重试", 429, "temporarily_locked");
    }
    if (!(await passwordMatches(input.password, policy.passwordDigest))) {
      const count = (failed?.count ?? 0) + 1;
      this.failures.set(key, { count, blockedUntil: count >= MAX_FAILURES ? Date.now() + BLOCK_MS : 0 });
      throw new SecurityDomainAccessError("密码不正确", 403, "invalid_password");
    }
    this.failures.delete(key);
    return this.createGrant(policy, input.userId);
  }

  async changePassword(input: {
    organizationId: string;
    userId: string;
    cookie?: string | string[];
    password: string;
  }): Promise<string> {
    this.ensureReady();
    const policy = await this.requireUnlocked(input.organizationId, input.userId, input.cookie);
    this.validatePassword(input.password);
    const updated = await this.db.securityDomainAccessPolicy.update({
      where: { organizationId: input.organizationId },
      data: {
        passwordDigest: await passwordDigest(input.password),
        passwordVersion: { increment: 1 },
        updatedByUserId: input.userId
      }
    });
    return this.createGrant(updated, input.userId);
  }

  async requireUnlocked(organizationId: string, userId: string, cookie?: string | string[]): Promise<AccessPolicy> {
    const policy = await this.policy(organizationId);
    if (!policy || !this.readGrant(cookie, policy, userId)) {
      throw new SecurityDomainAccessError("请输入保密域密码后继续", 423, "security_domain_locked");
    }
    return policy;
  }

  clearCookie(): string {
    return this.serializeCookie("", 0);
  }

  private policy(organizationId: string): Promise<AccessPolicy | null> {
    return this.db.securityDomainAccessPolicy.findUnique({ where: { organizationId } });
  }

  private validatePassword(password: string) {
    if (password.length < 10 || password.length > 128) {
      throw new SecurityDomainAccessError("密码长度需要为 10–128 个字符", 400, "weak_password");
    }
  }

  private ensureReady() {
    if (!this.options.secret) {
      throw new SecurityDomainAccessError("服务端会话密钥尚未配置", 503, "access_control_unavailable");
    }
  }

  private grantTtlMs(): number {
    return this.options.grantTtlMs ?? 30 * 60 * 1000;
  }

  private createGrant(policy: AccessPolicy, userId: string): string {
    if (!this.options.secret) throw new Error("session cookie secret is not configured");
    const payload = Buffer.from(
      JSON.stringify({
        organizationId: policy.organizationId,
        userId,
        passwordVersion: policy.passwordVersion,
        expiresAt: Date.now() + this.grantTtlMs()
      } satisfies GrantPayload)
    ).toString("base64url");
    const signature = createHmac("sha256", this.options.secret).update(payload).digest("base64url");
    return this.serializeCookie(`${payload}.${signature}`, this.grantTtlMs());
  }

  private readGrant(cookie: string | string[] | undefined, policy: AccessPolicy, userId: string): boolean {
    const raw = parseCookies(cookie).get(this.options.cookieName);
    if (!raw || !this.options.secret) return false;
    const index = raw.lastIndexOf(".");
    if (index <= 0) return false;
    const payloadText = raw.slice(0, index);
    const supplied = Buffer.from(raw.slice(index + 1));
    const expected = Buffer.from(createHmac("sha256", this.options.secret).update(payloadText).digest("base64url"));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
    try {
      const payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8")) as GrantPayload;
      return (
        payload.organizationId === policy.organizationId &&
        payload.userId === userId &&
        payload.passwordVersion === policy.passwordVersion &&
        payload.expiresAt > Date.now()
      );
    } catch {
      return false;
    }
  }

  private serializeCookie(value: string, maxAgeMs: number): string {
    const parts = [
      `${this.options.cookieName}=${value}`,
      "Path=/api/admin/security-domains",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
      `Expires=${new Date(Date.now() + maxAgeMs).toUTCString()}`
    ];
    if (this.options.secure) parts.push("Secure");
    return parts.join("; ");
  }
}
