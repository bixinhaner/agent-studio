import nodemailer from "nodemailer";

export type AuthEmailTransportConfig = {
  host?: string;
  port?: number;
  secure?: boolean;
  requireTls?: boolean;
  ignoreTls?: boolean;
  user?: string;
  pass?: string;
  from?: string;
  debug?: boolean;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeAddressList(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => trimOrUndefined(item)).filter(Boolean) as string[];
  }
  const single = trimOrUndefined(value);
  return single ? [single] : [];
}

export type AuthEmailSender = {
  send(input: {
    publicBrandId?: string;
    to: string | string[];
    cc?: string | string[];
    from?: string;
    replyTo?: string;
    subject: string;
    text: string;
    html?: string;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
      cid?: string;
    }>;
    debugLabel?: string;
  }): Promise<{ delivered: boolean; mode: "smtp" | "debug" }>;
};

function createTransporter(config: AuthEmailTransportConfig) {
  const host = trimOrUndefined(config.host);
  const from = trimOrUndefined(config.from);
  const user = trimOrUndefined(config.user);
  const pass = trimOrUndefined(config.pass);
  const ready = Boolean(host && from);
  return ready
    ? nodemailer.createTransport({
        host,
        port: Number.isFinite(config.port) ? config.port : 587,
        secure: Boolean(config.secure),
        requireTLS: Boolean(config.requireTls),
        ignoreTLS: Boolean(config.ignoreTls),
        auth: user || pass ? { user, pass } : undefined
      })
    : null;
}

export async function verifyAuthEmailTransport(config: AuthEmailTransportConfig): Promise<void> {
  const transporter = createTransporter(config);
  if (!transporter) throw new Error("SMTP transport is incomplete");
  await transporter.verify();
}

export function createAuthEmailSender(config: AuthEmailTransportConfig): AuthEmailSender {
  const from = trimOrUndefined(config.from);
  const transporter = createTransporter(config);

  return {
    async send(input) {
      const to = normalizeAddressList(input.to);
      const cc = normalizeAddressList(input.cc);
      const messageFrom = trimOrUndefined(input.from) ?? from;
      const replyTo = trimOrUndefined(input.replyTo);
      if (!to.length) {
        throw new Error("email target is required");
      }

      if (!transporter) {
        const label = trimOrUndefined(input.debugLabel) ?? "auth-email";
        console.info(`[${label}]`, {
          to,
          cc,
          from: messageFrom,
          replyTo,
          subject: input.subject,
          text: input.text,
          attachments: input.attachments?.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.content.length,
            cid: attachment.cid
          }))
        });
        return { delivered: false, mode: "debug" };
      }

      await transporter.sendMail({
        from: messageFrom,
        to: to.join(", "),
        cc: cc.length ? cc.join(", ") : undefined,
        replyTo,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments
      });
      return { delivered: true, mode: "smtp" };
    }
  };
}

export function createBrandAwareEmailSender(
  fallback: AuthEmailSender,
  resolveTransport: (publicBrandId: string) => Promise<AuthEmailTransportConfig | undefined>
): AuthEmailSender {
  return {
    async send(input) {
      const publicBrandId = trimOrUndefined(input.publicBrandId);
      if (!publicBrandId) return fallback.send(input);
      const transport = await resolveTransport(publicBrandId);
      if (!transport) return fallback.send(input);
      return createAuthEmailSender(transport).send(input);
    }
  };
}
