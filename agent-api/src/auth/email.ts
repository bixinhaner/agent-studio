import nodemailer from "nodemailer";

type AuthEmailTransportConfig = {
  host?: string;
  port?: number;
  secure?: boolean;
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
    to: string | string[];
    cc?: string | string[];
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

export function createAuthEmailSender(config: AuthEmailTransportConfig): AuthEmailSender {
  const host = trimOrUndefined(config.host);
  const from = trimOrUndefined(config.from);
  const user = trimOrUndefined(config.user);
  const pass = trimOrUndefined(config.pass);
  const ready = Boolean(host && from);
  const transporter = ready
    ? nodemailer.createTransport({
        host,
        port: Number.isFinite(config.port) ? config.port : 587,
        secure: Boolean(config.secure),
        auth: user || pass ? { user, pass } : undefined
      })
    : null;

  return {
    async send(input) {
      const to = normalizeAddressList(input.to);
      const cc = normalizeAddressList(input.cc);
      const replyTo = trimOrUndefined(input.replyTo);
      if (!to.length) {
        throw new Error("email target is required");
      }

      if (!transporter) {
        const label = trimOrUndefined(input.debugLabel) ?? "auth-email";
        console.info(`[${label}]`, {
          to,
          cc,
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
        from,
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
