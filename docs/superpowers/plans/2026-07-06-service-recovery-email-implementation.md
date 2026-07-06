# Service Recovery Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Portal-tone service recovery email so admins send proactive Bailey care emails with styled HTML, bilingual templates, a clear CTA, and safe internal/customer-visible field separation.

**Architecture:** Keep the existing recovery case schema and send endpoint. Extend `ConversationRecoveryService` with an optional Portal URL resolver, update its bilingual draft generation, and replace the HTML renderer with a table-based inline-style template. Update the admin modal labels and helper copy so `rootCause` remains internal while `resolutionSummary` becomes the visible explanation block.

**Tech Stack:** TypeScript, Express service layer, Nodemailer-compatible `AuthEmailSender`, Vitest, React 18, Ant Design 5.

## Global Constraints

- Use Portal visual tokens for the email: primary `#FF4614`, hover-compatible `#FA5C32`, active-compatible `#E63B0F`, background `#fafafa`, card `#ffffff`, border `#e5e7eb`, text `#111827`, secondary text `#6b7280`.
- The customer-facing email must not include `rootCause`.
- `resolutionSummary` must render in the customer-visible `处理说明` / `What we addressed` block.
- The email must not include the original user question or technical error details.
- The primary CTA must link to Portal home from the production public app base URL.
- Do not change service recovery case creation rules or database schema.
- Admin Console remains dense and operational; the email surface uses Portal tone.

---

## File Structure

- Modify `agent-api/src/operations/conversation-recovery-service.ts`: update service dependencies, default templates, HTML renderer, helper functions, and send payload.
- Modify `agent-api/src/operations/conversation-recovery-service.test.ts`: verify bilingual templates, root-cause exclusion, resolution block, CTA URL, and styled HTML.
- Modify `agent-api/src/index.ts`: pass `appConfig.appBaseUrl` into the recovery service.
- Modify `agent-ui/src/features/admin/ConversationAuditView.tsx`: update modal labels, empty-state input prompts, and helper text for internal root cause, customer-visible explanation, and styled email body.
- No database migration required.

---

### Task 1: Backend Template Data And Portal URL

**Files:**
- Modify: `agent-api/src/operations/conversation-recovery-service.ts`
- Modify: `agent-api/src/index.ts`
- Test: `agent-api/src/operations/conversation-recovery-service.test.ts`

**Interfaces:**
- Consumes: existing `ConversationRecoveryService` constructor options.
- Produces: optional constructor option `resolvePortalUrl?: () => string | Promise<string>`, method `resolvePortalUrl(): Promise<string>`, and template bodies with the approved bilingual subjects.

- [ ] **Step 1: Write failing tests for bilingual suggested templates**

Add these assertions inside the existing `records a DingTalk failure as a recoverable case` test:

```ts
expect(record.suggestedEmail.templates.zh.subject).toBe("AgentStudio 已处理一次响应中断");
expect(record.suggestedEmail.templates.en.subject).toBe("AgentStudio has addressed a recent response interruption");
expect(record.suggestedEmail.templates.zh.bodyText).toContain("我们检测到一次回答未能完成，并已处理相关问题。");
expect(record.suggestedEmail.templates.en.bodyText).toContain("We detected an incomplete response and addressed the related issue.");
expect(record.suggestedEmail.templates.zh.bodyText).toContain("处理说明：");
expect(record.suggestedEmail.templates.en.bodyText).toContain("What we addressed:");
expect(record.suggestedEmail.templates.zh.bodyText).toContain("这封邮件是 AgentStudio 对近期服务体验的一次主动跟进，不包含您的具体对话内容。");
expect(record.suggestedEmail.templates.en.bodyText).toContain("This email is a proactive AgentStudio service follow-up and does not include your conversation content.");
```

- [ ] **Step 2: Run the targeted failing backend test**

Run:

```bash
cd agent-api && npm test -- src/operations/conversation-recovery-service.test.ts
```

Expected: the template assertions fail because the current subjects and body copy still describe a generic support follow-up.

- [ ] **Step 3: Add the Portal URL resolver interface**

In `ConversationRecoveryService` constructor dependencies, add:

```ts
resolvePortalUrl?: () => string | Promise<string>;
```

Add the private resolver:

```ts
  private async resolvePortalUrl(): Promise<string> {
    const raw = this.deps.resolvePortalUrl ? await this.deps.resolvePortalUrl() : "";
    return trimOrUndefined(raw)?.replace(/\/+$/, "") || "https://bailey.baicells.com";
  }
```

In `agent-api/src/index.ts`, pass the existing app base URL:

```ts
  resolvePortalUrl: () => appConfig.appBaseUrl
```

- [ ] **Step 4: Update the Chinese and English default templates**

Change the Chinese subject to:

```ts
const subject = `${input.brandName} 已处理一次响应中断`;
```

Use these Chinese body lines:

```ts
const bodyLines: Array<string | null> = [
  `${displayName}，`,
  "",
  `我们检测到一次回答未能完成，并已处理相关问题。`,
  `相关时间：${occurredAt}`,
  organizationName ? `关联组织：${organizationName}` : null,
  `当前状态：可以继续使用`,
  "",
  "处理说明：",
  input.row.resolutionSummary || DEFAULT_RECOVERY_RESOLUTION.zh,
  "",
  `您可以重新进入 ${input.brandName} 继续使用。`,
  "",
  `这封邮件是 ${input.brandName} 对近期服务体验的一次主动跟进，不包含您的具体对话内容。`
];
```

Change the English subject to:

```ts
const subject = `${input.brandName} has addressed a recent response interruption`;
```

Use these English body lines:

```ts
const bodyLines: Array<string | null> = [
  `${displayName},`,
  "",
  "We detected an incomplete response and addressed the related issue.",
  `Related time: ${occurredAt} UTC`,
  organizationName ? `Organization: ${organizationName}` : null,
  "Current status: Ready to continue",
  "",
  "What we addressed:",
  input.row.resolutionSummary || DEFAULT_RECOVERY_RESOLUTION.en,
  "",
  `You can return to ${input.brandName} and continue using it.`,
  "",
  `This email is a proactive ${input.brandName} service follow-up and does not include your conversation content.`
];
```

Define the default resolution copy near the email helpers:

```ts
const DEFAULT_RECOVERY_RESOLUTION = {
  zh: "我们已完成服务侧排查和处理。您可以重新进入 Bailey 继续使用；如果相同问题再次出现，可以直接回复这封邮件，我们会继续跟进。",
  en: "We have reviewed and addressed the service-side issue. You can return to Bailey and continue using it. If the same issue appears again, reply to this email and we will follow up."
} as const;
```

- [ ] **Step 5: Run the backend template test**

Run:

```bash
cd agent-api && npm test -- src/operations/conversation-recovery-service.test.ts
```

Expected: template assertions pass, while HTML assertions from Task 2 still need implementation.

---

### Task 2: Styled Portal-Tone HTML Email Renderer

**Files:**
- Modify: `agent-api/src/operations/conversation-recovery-service.ts`
- Test: `agent-api/src/operations/conversation-recovery-service.test.ts`

**Interfaces:**
- Consumes: `brandName`, `bodyText`, `templateLanguage`, `organizationName`, and `lastOccurredAt`.
- Produces: `recoveryEmailHtml(input)` containing a Portal-tone card, status pill, summary card, customer-visible explanation block, CTA, and trust footer.

- [ ] **Step 1: Write failing assertions for the send path**

In `sends a resolution email and records the notification result`, capture the HTML and assert the visible structure:

```ts
const sendCall = vi.mocked(emailSender.send).mock.calls[0]?.[0];
expect(sendCall.html).toContain("Service issue addressed");
expect(sendCall.html).toContain("We detected an incomplete response and addressed the issue");
expect(sendCall.html).toContain("What we addressed");
expect(sendCall.html).toContain("已修复运行时配置");
expect(sendCall.html).toContain("Continue using AgentStudio");
expect(sendCall.html).toContain("background:#fafafa");
expect(sendCall.html).toContain("background:#FF4614");
expect(sendCall.html).toContain("href=\"https://portal.example.com\"");
expect(sendCall.html).not.toContain("runtime error");
```

Construct the service in this test with:

```ts
resolvePortalUrl: () => "https://portal.example.com"
```

- [ ] **Step 2: Run the targeted failing backend test**

Run:

```bash
cd agent-api && npm test -- src/operations/conversation-recovery-service.test.ts
```

Expected: the HTML assertions fail because the current renderer has no CTA, status pill, or Portal styling.

- [ ] **Step 3: Pass structured values into the HTML renderer**

Inside `sendResolutionEmail`, resolve Portal URL before sending:

```ts
const portalUrl = await this.resolvePortalUrl();
```

Call the renderer with:

```ts
html: recoveryEmailHtml({
  brandName,
  subject,
  bodyText,
  templateLanguage,
  organizationName: hydrated.organization?.name ?? undefined,
  lastOccurredAt: hydrated.lastOccurredAt,
  resolutionSummary: trimOrUndefined(input.resolutionSummary ?? undefined) ?? hydrated.resolutionSummary,
  portalUrl
})
```

- [ ] **Step 4: Replace the HTML renderer with the approved layout**

Update `recoveryEmailHtml` input type to include:

```ts
lastOccurredAt: string;
resolutionSummary?: string;
portalUrl: string;
```

Compute language-specific labels:

```ts
const copy = input.templateLanguage === "en"
  ? {
      status: "Service issue addressed",
      h1: "We detected an incomplete response and addressed the issue",
      lead: `The related service issue has been handled. You can continue using ${input.brandName}.`,
      relatedTime: "Related Time",
      organization: "Organization",
      currentStatus: "Current Status",
      ready: "Ready to continue",
      explanation: "What we addressed",
      cta: `Continue using ${input.brandName}`,
      footer: `This email is a proactive ${input.brandName} service follow-up and does not include your conversation content.`
    }
  : {
      status: "服务问题已处理",
      h1: "我们检测到一次回答未能完成，并已处理相关问题",
      lead: `相关服务问题已经处理完成。您可以继续使用 ${input.brandName}。`,
      relatedTime: "相关时间",
      organization: "关联组织",
      currentStatus: "当前状态",
      ready: "可以继续使用",
      explanation: "处理说明",
      cta: `继续使用 ${input.brandName}`,
      footer: `这封邮件是 ${input.brandName} 对近期服务体验的一次主动跟进，不包含您的具体对话内容。`
    };
```

Render a table-based HTML email with inline styles matching the approved visual direction:

```ts
return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fafafa;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafafa;margin:0;padding:28px 0;">
      <tr>
        <td align="center" style="padding:0 14px;">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:620px;max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;border-collapse:separate;overflow:hidden;">
            <tr><td style="padding:28px 32px 18px;font-family:Arial,Helvetica,sans-serif;color:#111827;">brand status and hero copy</td></tr>
            <tr><td style="padding:0 32px 18px;font-family:Arial,Helvetica,sans-serif;color:#111827;">summary card</td></tr>
            <tr><td style="padding:0 32px 22px;font-family:Arial,Helvetica,sans-serif;color:#111827;">customer-visible explanation block</td></tr>
            <tr><td style="padding:0 32px 30px;font-family:Arial,Helvetica,sans-serif;color:#111827;">Portal CTA button</td></tr>
            <tr><td style="padding:18px 32px 24px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;border-top:1px solid #f3f4f6;">trust footer</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
```

Include these visible blocks in order: brand/status row, H1 and lead, summary table, explanation block with `resolutionSummary`, CTA anchor with `background:#FF4614`, footer.

- [ ] **Step 5: Add small helpers for email-safe formatting**

Add:

```ts
function formatRecoveryEmailTime(value: string, language: "zh" | "en"): string {
  const date = new Date(value);
  if (language === "en") {
    return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
  }
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}
```

Add a paragraph renderer for the explanation block:

```ts
function textToHtmlLines(value: string): string {
  return escapeHtml(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 8px;font-size:14px;line-height:22px;color:#374151;">${line}</p>`)
    .join("");
}
```

- [ ] **Step 6: Run the backend test**

Run:

```bash
cd agent-api && npm test -- src/operations/conversation-recovery-service.test.ts
```

Expected: all conversation recovery service tests pass.

---

### Task 3: Admin Modal Copy And Field Guidance

**Files:**
- Modify: `agent-ui/src/features/admin/ConversationAuditView.tsx`

**Interfaces:**
- Consumes: existing modal state and `syncRecoverySummaryIntoEmailBody`.
- Produces: clearer admin labels and helper text without changing API payloads.

- [ ] **Step 1: Update summary default text constants**

Replace `RECOVERY_EMAIL_SUMMARY_PLACEHOLDER_BY_LANGUAGE` values with:

```ts
const RECOVERY_EMAIL_SUMMARY_PLACEHOLDER_BY_LANGUAGE: Record<RecoveryEmailTemplateLanguage, string> = {
  zh: "我们已完成服务侧排查和处理。您可以重新进入 Bailey 继续使用；如果相同问题再次出现，可以直接回复这封邮件，我们会继续跟进。",
  en: "We have reviewed and addressed the service-side issue. You can return to Bailey and continue using it. If the same issue appears again, reply to this email and we will follow up."
};
```

- [ ] **Step 2: Update modal fields with explicit labels**

Inside the email modal grid, add labels using `Typography.Text` before each input and update empty-state input prompts:

```tsx
<Typography.Text strong>收件邮箱</Typography.Text>
<Input aria-label="收件邮箱" placeholder="user@example.com" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} />
<Typography.Text strong>邮件标题</Typography.Text>
<Input aria-label="邮件标题" placeholder="邮件标题" value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} />
<Typography.Text strong>内部根因（不会发送给用户）</Typography.Text>
<Input.TextArea aria-label="内部根因，不会发送给用户" placeholder="仅供内部复盘，例如模型输出、知识库、工具调用或服务异常原因" rows={2} value={rootCause} onChange={(event) => setRootCause(event.target.value)} />
<Typography.Text strong>用户可见说明（会进入邮件）</Typography.Text>
<Input.TextArea
  aria-label="用户可见说明，会进入邮件"
  placeholder={RECOVERY_EMAIL_SUMMARY_PLACEHOLDER_BY_LANGUAGE[emailTemplateLanguage]}
  rows={3}
  value={resolutionSummary}
  onChange={(event) => {
    const nextValue = event.target.value;
    setEmailBodyText((current) => syncRecoverySummaryIntoEmailBody(current, resolutionSummary, nextValue, emailTemplateLanguage));
    setResolutionSummary(nextValue);
  }}
/>
<Typography.Text strong>邮件正文</Typography.Text>
<Typography.Text type="secondary" style={{ fontSize: 12 }}>发送时会自动套用样式化邮件模板；这里编辑的是纯文本正文和邮件客户端降级内容。</Typography.Text>
<Input.TextArea aria-label="邮件正文" placeholder="邮件正文" rows={10} value={emailBodyText} onChange={(event) => setEmailBodyText(event.target.value)} />
```

- [ ] **Step 3: Keep language switching behavior intact**

Run through the code path:

```ts
const applyEmailTemplate = (language: RecoveryEmailTemplateLanguage) => {
  const template = recoveryCase.suggestedEmail.templates?.[language] ?? recoveryCase.suggestedEmail;
  setEmailTemplateLanguage(language);
  setEmailSubject(template.subject);
  setEmailBodyText(syncRecoverySummaryIntoEmailBody(template.bodyText, "", resolutionSummary, language));
};
```

Expected: language switching still updates subject/body and retains the current user-visible explanation.

- [ ] **Step 4: Run the frontend build**

Run:

```bash
cd agent-ui && npm run build
```

Expected: TypeScript build and Vite build pass.

---

### Task 4: Production-Like Verification And Real Sample Emails

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: local or production service recovery send path.
- Produces: two delivered sample emails to `like@baicells.com`, one Chinese and one English, without test wording.

- [ ] **Step 1: Run backend and frontend checks**

Run:

```bash
cd agent-api && npm test -- src/operations/conversation-recovery-service.test.ts
cd ../agent-ui && npm run build
```

Expected: both commands pass.

- [ ] **Step 2: Inspect git diff**

Run:

```bash
git diff -- agent-api/src/operations/conversation-recovery-service.ts agent-api/src/operations/conversation-recovery-service.test.ts agent-api/src/index.ts agent-ui/src/features/admin/ConversationAuditView.tsx
```

Expected: diff only covers recovery email templates, HTML renderer, Portal URL injection, tests, and admin modal copy.

- [ ] **Step 3: Send two real sample emails after deployment or against production SMTP**

Use an existing real recovery case and the normal send path to send:

```text
recipientEmail: like@baicells.com
templateLanguage: zh
subject: Bailey 已处理一次响应中断
```

Then send:

```text
recipientEmail: like@baicells.com
templateLanguage: en
subject: Bailey has addressed a recent response interruption
```

Expected: both emails have no testing wording, preserve the approved Portal-tone style, include the CTA to Portal home, and do not include `rootCause`.
