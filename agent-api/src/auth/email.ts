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

export type AuthEmailSender = {
  send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
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
      const to = trimOrUndefined(input.to);
      if (!to) {
        throw new Error("email target is required");
      }

      if (!transporter) {
        const label = trimOrUndefined(input.debugLabel) ?? "auth-email";
        console.info(`[${label}]`, {
          to,
          subject: input.subject,
          text: input.text
        });
        return { delivered: false, mode: "debug" };
      }

      await transporter.sendMail({
        from,
        to,
        subject: input.subject,
        text: input.text,
        html: input.html
      });
      return { delivered: true, mode: "smtp" };
    }
  };
}
