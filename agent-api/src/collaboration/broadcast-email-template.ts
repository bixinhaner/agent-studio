import crypto from "node:crypto";

import type { SystemSettingsBranding } from "../system-settings/types.js";
import type {
  BroadcastContent
} from "../persistence/broadcast-repository.js";
import type { BroadcastAudienceRecipient } from "./broadcast-audience.js";

const PORTAL_ACCENT = "#FF4614";

export type BroadcastEmailRenderInput = {
  branding: SystemSettingsBranding;
  content: BroadcastContent;
  recipient: BroadcastAudienceRecipient;
  portalBaseUrl: string;
};

export type BroadcastEmailRenderResult = {
  subject: string;
  text: string;
  html: string;
  fingerprint: string;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .trim();
}

function textToHtml(value: string): string {
  const lines = stripMarkdown(value).split(/\n{2,}/g).map((line) => line.trim()).filter(Boolean);
  return lines
    .map((line) => `<p style="margin:0 0 14px;font-size:15px;line-height:25px;color:#374151;">${escapeHtml(line).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function replaceVariables(value: string, input: BroadcastEmailRenderInput): string {
  const recipientName = input.recipient.displayName || input.recipient.email || "there";
  const organizationName = input.recipient.organizationName || "your organization";
  return value
    .replaceAll("{{user_name}}", recipientName)
    .replaceAll("{{organization_name}}", organizationName)
    .replaceAll("{{platform_name}}", input.branding.platformName)
    .replaceAll("{{assistant_name}}", input.branding.assistantName);
}

function absoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
  const raw = trimOrUndefined(value);
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = trimOrUndefined(baseUrl)?.replace(/\/+$/, "");
  if (!base) return raw;
  return `${base}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function portalUrl(input: BroadcastEmailRenderInput): string {
  const ctaUrl = absoluteUrl(replaceVariables(input.content.ctaUrl ?? "", input), input.portalBaseUrl);
  return ctaUrl || input.portalBaseUrl.replace(/\/+$/, "");
}

function fingerprint(input: BroadcastEmailRenderInput): string {
  const payload = {
    platformName: input.branding.platformName,
    assistantName: input.branding.assistantName,
    logoUrl: input.branding.logoUrl,
    iconUrl: input.branding.iconUrl,
    content: input.content,
    portalBaseUrl: input.portalBaseUrl.replace(/\/+$/, "")
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function renderBroadcastEmail(input: BroadcastEmailRenderInput): BroadcastEmailRenderResult {
  const brandName = trimOrUndefined(input.branding.platformName) ?? "Agent Studio";
  const assistantName = trimOrUndefined(input.branding.assistantName) ?? brandName;
  const subject = replaceVariables(input.content.subject, input);
  const body = replaceVariables(input.content.bodyMarkdown, input);
  const ctaLabel = trimOrUndefined(replaceVariables(input.content.ctaLabel ?? "", input)) ?? (input.content.language === "en" ? `Open ${assistantName}` : `打开 ${assistantName}`);
  const ctaUrl = portalUrl(input);
  const logoUrl = absoluteUrl(input.branding.logoUrl || input.branding.iconUrl, input.portalBaseUrl);
  const preheader = input.content.language === "en"
    ? `${assistantName} prepared a follow-up to help you keep using the workspace.`
    : `${assistantName} 为您准备了继续使用工作台的建议。`;
  const footer = input.content.language === "en"
    ? `You are receiving this email because your organization uses ${brandName}. You can manage email preferences from the workspace.`
    : `您收到这封邮件，是因为您的组织正在使用 ${brandName}。您可以在工作台中管理邮件偏好。`;

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="34" height="34" alt="${escapeHtml(brandName)}" style="display:block;width:34px;height:34px;object-fit:contain;border-radius:9px;">`
    : `<span style="display:inline-block;width:14px;height:14px;border-radius:999px;background:${PORTAL_ACCENT};"></span>`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fafafa;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafafa;margin:0;padding:30px 0;">
      <tr>
        <td align="center" style="padding:0 14px;">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:620px;max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td style="padding:30px 34px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;background:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;width:42px;">${logoBlock}</td>
                    <td style="vertical-align:middle;">
                      <p style="margin:0;font-size:15px;line-height:21px;font-weight:bold;color:#111827;">${escapeHtml(brandName)}</p>
                      <p style="margin:2px 0 0;font-size:12px;line-height:18px;color:#6b7280;">${escapeHtml(assistantName)}</p>
                    </td>
                  </tr>
                </table>
                <h1 style="margin:26px 0 10px;font-size:28px;line-height:36px;font-weight:bold;color:#111827;">${escapeHtml(subject)}</h1>
                <p style="margin:0;font-size:15px;line-height:24px;color:#4b5563;">${escapeHtml(preheader)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 34px 8px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                ${textToHtml(body)}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 34px 30px;font-family:Arial,Helvetica,sans-serif;">
                <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${PORTAL_ACCENT};color:#ffffff;text-decoration:none;border-radius:12px;padding:13px 22px;font-size:15px;line-height:20px;font-weight:bold;">${escapeHtml(ctaLabel)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 34px 24px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;border-top:1px solid #f3f4f6;background:#ffffff;">
                <p style="margin:0;font-size:12px;line-height:19px;">${escapeHtml(footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject,
    text: `${subject}\n\n${stripMarkdown(body)}\n\n${ctaLabel}: ${ctaUrl}\n\n${footer}`,
    html,
    fingerprint: fingerprint(input)
  };
}
