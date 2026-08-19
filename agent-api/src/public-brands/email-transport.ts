import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import {
  createAuthEmailSender,
  verifyAuthEmailTransport,
  type AuthEmailSender,
  type AuthEmailTransportConfig
} from "../auth/email.js";

const optionalText = z.string().trim().max(500).optional().nullable().transform((value) => value || null);

export const publicBrandEmailTransportInputSchema = z.object({
  mode: z.enum(["shared", "smtp"]),
  smtpHost: optionalText,
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpSecurity: z.enum(["starttls", "tls", "none"]).default("starttls"),
  smtpUsername: optionalText,
  smtpPassword: z.string().max(2000).optional(),
  clearPassword: z.boolean().optional().default(false)
}).superRefine((value, context) => {
  if (value.mode !== "smtp") return;
  if (!value.smtpHost || value.smtpHost.includes("://") || /[\s/]/.test(value.smtpHost)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["smtpHost"], message: "SMTP host is invalid" });
  }
  if (!value.smtpUsername) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["smtpUsername"], message: "SMTP username is required" });
  }
});

export const publicBrandEmailTestSchema = z.object({
  recipient: z.string().trim().email("recipient email is invalid")
});

export type PublicBrandEmailTransportInput = z.infer<typeof publicBrandEmailTransportInputSchema>;
export type PublicBrandEmailTransportView = {
  mode: "shared" | "smtp";
  smtpHost: string | null;
  smtpPort: number;
  smtpSecurity: "starttls" | "tls" | "none";
  smtpUsername: string | null;
  passwordConfigured: boolean;
  verificationStatus: "pending" | "verified" | "failed";
  smtpConnected: boolean;
  senderAccepted: boolean;
  deliveryAccepted: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  credentialsRotatedAt: string | null;
  updatedAt: string | null;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function encryptionKey(secret: string): Buffer {
  const normalized = secret.trim();
  if (normalized.length < 32) {
    throw new Error("Brand SMTP credential encryption is not configured");
  }
  return createHash("sha256").update(normalized).digest();
}

export function encryptBrandEmailPassword(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptBrandEmailPassword(value: string, secret: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Brand SMTP credential is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function normalizeSecurity(value: string): "starttls" | "tls" | "none" {
  return value === "tls" || value === "none" ? value : "starttls";
}

function transportConfig(input: {
  host: string;
  port: number;
  security: "starttls" | "tls" | "none";
  username?: string;
  password?: string;
  from: string;
}): AuthEmailTransportConfig {
  return {
    host: input.host,
    port: input.port,
    secure: input.security === "tls",
    requireTls: input.security === "starttls",
    ignoreTls: input.security === "none",
    user: input.username,
    pass: input.password,
    from: input.from
  };
}

function smtpFailureMessage(error: unknown): string {
  const source = error && typeof error === "object" ? error as { code?: unknown; responseCode?: unknown; command?: unknown } : {};
  const code = typeof source.code === "string" ? source.code.toUpperCase() : "";
  const responseCode = typeof source.responseCode === "number" ? source.responseCode : 0;
  if (code === "EAUTH" || responseCode === 535) return "SMTP 登录失败，请检查用户名、密码或授权码";
  if (["ECONNECTION", "ECONNREFUSED", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(code)) {
    return "无法连接 SMTP 服务器，请检查服务器地址、端口和加密方式";
  }
  if (responseCode >= 500) return "SMTP 服务器拒绝了发件人或收件人，请检查邮箱授权策略";
  return "测试邮件发送失败，请检查 SMTP 配置后重试";
}

export class PublicBrandEmailTransportService {
  constructor(
    private readonly db: PrismaClient,
    private readonly options: {
      credentialSecret: string;
      sharedTransport: AuthEmailTransportConfig;
      verifyTransport?: (config: AuthEmailTransportConfig) => Promise<void>;
      sendTestEmail?: (
        config: AuthEmailTransportConfig,
        message: Parameters<AuthEmailSender["send"]>[0]
      ) => Promise<void>;
    }
  ) {}

  async get(brandId: string): Promise<PublicBrandEmailTransportView> {
    const [brand, row] = await Promise.all([
      this.db.publicBrand.findUnique({ where: { id: brandId }, select: { id: true, emailSenderVerified: true } }),
      this.db.publicBrandEmailTransport.findUnique({ where: { publicBrandId: brandId } })
    ]);
    if (!brand) throw new Error("Brand does not exist");
    const verified = row?.verificationStatus === "verified" || (!row && brand.emailSenderVerified);
    return {
      mode: row?.mode === "smtp" ? "smtp" : "shared",
      smtpHost: row?.smtpHost ?? null,
      smtpPort: row?.smtpPort ?? 587,
      smtpSecurity: normalizeSecurity(row?.smtpSecurity ?? "starttls"),
      smtpUsername: row?.smtpUsername ?? null,
      passwordConfigured: Boolean(row?.smtpPasswordEncrypted),
      verificationStatus: verified ? "verified" : row?.verificationStatus === "failed" ? "failed" : "pending",
      smtpConnected: row?.smtpConnected ?? verified,
      senderAccepted: row?.senderAccepted ?? verified,
      deliveryAccepted: row?.deliveryAccepted ?? verified,
      lastTestedAt: toIso(row?.lastTestedAt),
      lastTestError: row?.lastTestError ?? null,
      credentialsRotatedAt: toIso(row?.credentialsRotatedAt),
      updatedAt: toIso(row?.updatedAt)
    };
  }

  async update(brandId: string, rawInput: unknown, actorUserId: string): Promise<PublicBrandEmailTransportView> {
    const input = publicBrandEmailTransportInputSchema.parse(rawInput);
    const [brand, existing] = await Promise.all([
      this.db.publicBrand.findUnique({ where: { id: brandId }, select: { id: true } }),
      this.db.publicBrandEmailTransport.findUnique({ where: { publicBrandId: brandId } })
    ]);
    if (!brand) throw new Error("Brand does not exist");

    const nextPassword = input.clearPassword
      ? null
      : input.smtpPassword
        ? encryptBrandEmailPassword(input.smtpPassword, this.options.credentialSecret)
        : existing?.smtpPasswordEncrypted ?? null;
    if (input.mode === "smtp" && !nextPassword) throw new Error("SMTP password or authorization code is required");

    const changed = !existing
      || existing.mode !== input.mode
      || existing.smtpHost !== input.smtpHost
      || existing.smtpPort !== input.smtpPort
      || existing.smtpSecurity !== input.smtpSecurity
      || existing.smtpUsername !== input.smtpUsername
      || Boolean(input.smtpPassword)
      || input.clearPassword;
    const data = {
      mode: input.mode,
      smtpHost: input.mode === "smtp" ? input.smtpHost : null,
      smtpPort: input.smtpPort,
      smtpSecurity: input.smtpSecurity,
      smtpUsername: input.mode === "smtp" ? input.smtpUsername : null,
      smtpPasswordEncrypted: input.mode === "smtp" ? nextPassword : null,
      ...(changed ? {
        verificationStatus: "pending",
        smtpConnected: false,
        senderAccepted: false,
        deliveryAccepted: false,
        lastTestError: null
      } : {}),
      ...(input.smtpPassword ? { credentialsRotatedAt: new Date() } : {}),
      updatedByUserId: actorUserId
    };
    await this.db.$transaction([
      this.db.publicBrandEmailTransport.upsert({
        where: { publicBrandId: brandId },
        create: { publicBrandId: brandId, ...data },
        update: data
      }),
      ...(changed ? [this.db.publicBrand.update({ where: { id: brandId }, data: { emailSenderVerified: false, updatedByUserId: actorUserId } })] : [])
    ]);
    return this.get(brandId);
  }

  async resolveDedicatedTransport(brandId: string): Promise<AuthEmailTransportConfig | undefined> {
    const [brand, row] = await Promise.all([
      this.db.publicBrand.findUnique({ where: { id: brandId }, select: { emailFromAddress: true } }),
      this.db.publicBrandEmailTransport.findUnique({ where: { publicBrandId: brandId } })
    ]);
    if (!brand || !row || row.mode !== "smtp") return undefined;
    const from = trimOrUndefined(brand.emailFromAddress);
    const host = trimOrUndefined(row.smtpHost);
    const username = trimOrUndefined(row.smtpUsername);
    if (!from || !host || !username || !row.smtpPasswordEncrypted) {
      throw new Error("Brand SMTP transport is incomplete");
    }
    return transportConfig({
      host,
      port: row.smtpPort,
      security: normalizeSecurity(row.smtpSecurity),
      username,
      password: decryptBrandEmailPassword(row.smtpPasswordEncrypted, this.options.credentialSecret),
      from
    });
  }

  async test(brandId: string, rawInput: unknown, actorUserId: string): Promise<PublicBrandEmailTransportView> {
    const { recipient } = publicBrandEmailTestSchema.parse(rawInput);
    const brand = await this.db.publicBrand.findUnique({
      where: { id: brandId },
      select: {
        id: true,
        platformName: true,
        primaryColor: true,
        emailFromName: true,
        emailFromAddress: true,
        emailReplyTo: true,
        supportEmail: true
      }
    });
    if (!brand) throw new Error("Brand does not exist");
    const fromAddress = trimOrUndefined(brand.emailFromAddress);
    if (!fromAddress) throw new Error("请先配置品牌发件邮箱");
    const current = await this.get(brandId);

    try {
      const config = current.mode === "smtp"
        ? await this.resolveDedicatedTransport(brandId)
        : { ...this.options.sharedTransport, from: fromAddress };
      if (!config) throw new Error("Brand SMTP transport is incomplete");
      await (this.options.verifyTransport ?? verifyAuthEmailTransport)(config);
      await this.db.publicBrandEmailTransport.upsert({
        where: { publicBrandId: brandId },
        create: { publicBrandId: brandId, mode: current.mode, verificationStatus: "pending", smtpConnected: true, updatedByUserId: actorUserId },
        update: { verificationStatus: "pending", smtpConnected: true, senderAccepted: false, deliveryAccepted: false, lastTestError: null, updatedByUserId: actorUserId }
      });
      const message: Parameters<AuthEmailSender["send"]>[0] = {
        to: recipient,
        from: `${brand.emailFromName} <${fromAddress}>`,
        replyTo: trimOrUndefined(brand.emailReplyTo) ?? trimOrUndefined(brand.supportEmail),
        subject: `${brand.platformName} email delivery test`,
        text: `This test confirms that ${brand.platformName} can send customer email through its configured SMTP channel.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827"><h2 style="color:${brand.primaryColor}">${brand.platformName} email delivery test</h2><p>This message confirms that the configured SMTP channel accepted a branded customer email.</p><p>No action is required.</p></div>`,
        debugLabel: "public-brand-email-test"
      };
      if (this.options.sendTestEmail) {
        await this.options.sendTestEmail(config, message);
      } else {
        await createAuthEmailSender(config).send(message);
      }
      const testedAt = new Date();
      await this.db.$transaction([
        this.db.publicBrandEmailTransport.update({
          where: { publicBrandId: brandId },
          data: {
            verificationStatus: "verified",
            smtpConnected: true,
            senderAccepted: true,
            deliveryAccepted: true,
            lastTestedAt: testedAt,
            lastTestError: null,
            updatedByUserId: actorUserId
          }
        }),
        this.db.publicBrand.update({ where: { id: brandId }, data: { emailSenderVerified: true, updatedByUserId: actorUserId } })
      ]);
      return this.get(brandId);
    } catch (error) {
      const detail = smtpFailureMessage(error);
      await this.db.$transaction([
        this.db.publicBrandEmailTransport.upsert({
          where: { publicBrandId: brandId },
          create: { publicBrandId: brandId, mode: current.mode, verificationStatus: "failed", lastTestedAt: new Date(), lastTestError: detail, updatedByUserId: actorUserId },
          update: { verificationStatus: "failed", senderAccepted: false, deliveryAccepted: false, lastTestedAt: new Date(), lastTestError: detail, updatedByUserId: actorUserId }
        }),
        this.db.publicBrand.update({ where: { id: brandId }, data: { emailSenderVerified: false, updatedByUserId: actorUserId } })
      ]);
      throw new Error(detail);
    }
  }
}
