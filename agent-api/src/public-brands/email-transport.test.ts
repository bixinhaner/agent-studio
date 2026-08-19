import { describe, expect, it, vi } from "vitest";

import {
  decryptBrandEmailPassword,
  encryptBrandEmailPassword,
  PublicBrandEmailTransportService
} from "./email-transport.js";

const SECRET = "brand-email-secret-that-is-long-enough-for-tests";

function testDatabase() {
  const brand = {
    id: "brand-ranley",
    platformName: "Ranley",
    primaryColor: "#0066FF",
    emailFromName: "Ranley",
    emailFromAddress: "lion.li@cloud-ran.ai",
    emailReplyTo: "lion.li@cloud-ran.ai",
    supportEmail: "lion.li@cloud-ran.ai",
    emailSenderVerified: false,
    updatedByUserId: null as string | null
  };
  let transport: Record<string, any> | null = null;
  const now = () => new Date("2026-08-19T01:00:00.000Z");
  const db = {
    publicBrand: {
      findUnique: vi.fn(async ({ where }: any) => where.id === brand.id ? { ...brand } : null),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(brand, data);
        return { ...brand };
      })
    },
    publicBrandEmailTransport: {
      findUnique: vi.fn(async ({ where }: any) => where.publicBrandId === brand.id && transport ? { ...transport } : null),
      upsert: vi.fn(async ({ create, update }: any) => {
        transport = transport
          ? { ...transport, ...update, updatedAt: now() }
          : { ...create, createdAt: now(), updatedAt: now() };
        return { ...transport };
      }),
      update: vi.fn(async ({ data }: any) => {
        if (!transport) throw new Error("missing transport");
        transport = { ...transport, ...data, updatedAt: now() };
        return { ...transport };
      })
    },
    $transaction: vi.fn(async (queries: Array<Promise<unknown>>) => Promise.all(queries))
  };
  return { db: db as never, brand, getTransport: () => transport };
}

describe("PublicBrandEmailTransportService", () => {
  it("encrypts SMTP passwords and rejects a different key", () => {
    const encrypted = encryptBrandEmailPassword("mailbox-password", SECRET);
    expect(encrypted).not.toContain("mailbox-password");
    expect(decryptBrandEmailPassword(encrypted, SECRET)).toBe("mailbox-password");
    expect(() => decryptBrandEmailPassword(encrypted, `${SECRET}-wrong`)).toThrow();
  });

  it("stores a dedicated SMTP credential without returning the raw password", async () => {
    const state = testDatabase();
    const service = new PublicBrandEmailTransportService(state.db, {
      credentialSecret: SECRET,
      sharedTransport: {}
    });

    const view = await service.update("brand-ranley", {
      mode: "smtp",
      smtpHost: "smtp.partner.outlook.cn",
      smtpPort: 587,
      smtpSecurity: "starttls",
      smtpUsername: "lion.li@cloud-ran.ai",
      smtpPassword: "mailbox-password"
    }, "admin-1");

    expect(view).toMatchObject({ mode: "smtp", passwordConfigured: true, verificationStatus: "pending" });
    expect(JSON.stringify(view)).not.toContain("mailbox-password");
    expect(String(state.getTransport()?.smtpPasswordEncrypted)).not.toContain("mailbox-password");
    expect(state.brand.emailSenderVerified).toBe(false);
    await expect(service.resolveDedicatedTransport("brand-ranley")).resolves.toMatchObject({
      host: "smtp.partner.outlook.cn",
      user: "lion.li@cloud-ran.ai",
      pass: "mailbox-password",
      requireTls: true
    });
  });

  it("opens the brand email channel only after connection and delivery succeed", async () => {
    const state = testDatabase();
    const verifyTransport = vi.fn(async () => undefined);
    const sendTestEmail = vi.fn(async () => undefined);
    const service = new PublicBrandEmailTransportService(state.db, {
      credentialSecret: SECRET,
      sharedTransport: {},
      verifyTransport,
      sendTestEmail
    });
    await service.update("brand-ranley", {
      mode: "smtp",
      smtpHost: "smtp.partner.outlook.cn",
      smtpPort: 587,
      smtpSecurity: "starttls",
      smtpUsername: "lion.li@cloud-ran.ai",
      smtpPassword: "mailbox-password"
    }, "admin-1");

    const result = await service.test("brand-ranley", { recipient: "owner@cloud-ran.ai" }, "admin-1");

    expect(verifyTransport).toHaveBeenCalledOnce();
    expect(sendTestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.partner.outlook.cn" }),
      expect.objectContaining({
        to: "owner@cloud-ran.ai",
        from: "Ranley <lion.li@cloud-ran.ai>"
      })
    );
    expect(result).toMatchObject({
      verificationStatus: "verified",
      smtpConnected: true,
      senderAccepted: true,
      deliveryAccepted: true
    });
    expect(state.brand.emailSenderVerified).toBe(true);
  });

  it("keeps the brand email channel closed and returns an actionable authentication error", async () => {
    const state = testDatabase();
    const service = new PublicBrandEmailTransportService(state.db, {
      credentialSecret: SECRET,
      sharedTransport: {},
      verifyTransport: vi.fn(async () => {
        throw Object.assign(new Error("raw provider response"), { code: "EAUTH", responseCode: 535 });
      }),
      sendTestEmail: vi.fn(async () => undefined)
    });
    await service.update("brand-ranley", {
      mode: "smtp",
      smtpHost: "smtp.partner.outlook.cn",
      smtpPort: 587,
      smtpSecurity: "starttls",
      smtpUsername: "lion.li@cloud-ran.ai",
      smtpPassword: "wrong-password"
    }, "admin-1");

    await expect(service.test("brand-ranley", { recipient: "owner@cloud-ran.ai" }, "admin-1"))
      .rejects.toThrow("SMTP 登录失败，请检查用户名、密码或授权码");
    await expect(service.get("brand-ranley")).resolves.toMatchObject({
      verificationStatus: "failed",
      senderAccepted: false,
      deliveryAccepted: false,
      lastTestError: "SMTP 登录失败，请检查用户名、密码或授权码"
    });
    expect(state.brand.emailSenderVerified).toBe(false);
  });
});
