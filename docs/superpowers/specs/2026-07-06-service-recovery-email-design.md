# Service Recovery Email Redesign

Date: 2026-07-06

## Context

Service recovery cases are created when Agent Studio detects that a user saw an answer failure. These cases are often not initiated by a customer support request. The email should therefore feel like proactive product care: Bailey detected a service interruption, handled the related service issue, and invites the user to continue using the product.

The current email reads like a support ticket follow-up. It also uses a plain, low-emphasis card and lacks a clear return-to-product action.

## Goals

1. Reposition recovery email as proactive Bailey service care, not customer support case handling.
2. Avoid implying the failed answer was automatically regenerated or restored.
3. Avoid language that makes users feel their specific conversation was being monitored.
4. Make the primary next action obvious: continue using Bailey.
5. Use Portal visual language: white card, restrained surfaces, Portal orange primary action, neutral typography.
6. Preserve the existing admin workflow: admins can edit recipient, subject, user-visible explanation, body, and send.

## Non-Goals

1. Do not auto-send resolution emails without admin review.
2. Do not link directly to the failed thread by default.
3. Do not include the original user question or error detail in the customer-facing email.
4. Do not add marketing recommendations, upsell modules, or promotional content.
5. Do not change service recovery case creation rules.

## Recommended Direction

Use the approved "active care card" direction with Portal styling.

The message should say the service issue was handled, not that the original answer was recovered.

Chinese subject:

```text
Bailey 已处理一次响应中断
```

English subject:

```text
Bailey has addressed a recent response interruption
```

Chinese H1:

```text
我们检测到一次回答未能完成，并已处理相关问题
```

English H1:

```text
We detected an incomplete response and addressed the issue
```

Primary CTA:

```text
继续使用 Bailey
Continue using Bailey
```

CTA target: Portal home URL from production public app base URL.

## Customer-Facing Content Model

The email should contain these visible sections:

1. Brand and status
   - Brand: Bailey
   - Status pill:
     - Chinese: `服务问题已处理`
     - English: `Service issue addressed`

2. Hero message
   - Explain that Bailey detected a response did not complete.
   - Explain the related service issue has been handled.
   - Tell the user they can continue using Bailey.

3. Summary card
   - Related time
   - Organization when known
   - Current status:
     - Chinese: `可以继续使用`
     - English: `Ready to continue`

4. User-visible explanation block
   - Label:
     - Chinese: `处理说明`
     - English: `What we addressed`
   - Source: admin `resolutionSummary`.
   - If empty, use a safe default that does not expose internals:
     - Chinese: `我们已完成服务侧排查和处理。您可以重新进入 Bailey 继续使用；如果相同问题再次出现，可以直接回复这封邮件，我们会继续跟进。`
     - English: `We have reviewed and addressed the service-side issue. You can return to Bailey and continue using it. If the same issue appears again, reply to this email and we will follow up.`

5. CTA button
   - Button text from the primary CTA above.
   - Link to Portal home.

6. Trust footer
   - Chinese: `这封邮件是 Bailey 对近期服务体验的一次主动跟进，不包含您的具体对话内容。`
   - English: `This email is a proactive Bailey service follow-up and does not include your conversation content.`
   - Existing reply path remains valid: users can reply if still affected.

## Admin Field Mapping

`rootCause`

- Internal only.
- Displayed in admin case details.
- Not included in customer-facing email.
- UI label should become:
  - Chinese admin UI: `内部根因（不会发送给用户）`

`resolutionSummary`

- Customer-facing.
- Rendered in the email's visible explanation block.
- Also synced into editable email body text for plain-text fallback.
- UI label should become:
  - Chinese admin UI: `用户可见说明（会进入邮件）`

`emailBodyText`

- The source text for both plain-text email and HTML paragraph rendering.
- Admin UI should clarify:
  - `发送时会自动套用样式化邮件模板；这里编辑的是正文内容。`

## Visual Design

Use Portal visual tokens and color direction:

- Primary color: `#FF4614`
- Primary hover-compatible color: `#FA5C32`
- Primary active-compatible color: `#E63B0F`
- Page background: `#fafafa`
- Card background: `#ffffff`
- Border: `#e5e7eb`
- Text: `#111827`
- Secondary text: `#6b7280`
- Card radius: `20px`
- CTA radius: `12px`

HTML email constraints:

- Use table-based outer layout for email client compatibility.
- Use inline styles.
- Keep max content width around `620px`.
- Use accessible button-like anchor with strong contrast.
- Avoid CSS features that are unreliable in email clients for core layout.
- Gradients may be used as a progressive enhancement, but the layout must remain readable if stripped.

The approved layout:

1. White card on light Portal background.
2. Soft hero header with brand mark, brand name, status pill, H1, and lead copy.
3. Summary card with related time, organization, and current status.
4. Orange-accented explanation block for admin-written user-visible reason.
5. Orange primary CTA button.
6. Small neutral footer explaining proactive service follow-up.

## Data Flow

1. Admin opens a service recovery case.
2. Backend returns suggested Chinese and English templates.
3. Admin chooses template language.
4. Admin fills internal root cause if needed.
5. Admin fills user-visible explanation.
6. UI syncs user-visible explanation into the body text.
7. Admin can edit final body text before sending.
8. Send endpoint persists `rootCause`, `resolutionSummary`, `emailSubject`, `emailBodyText`, and notification metadata.
9. Email sender sends both:
   - `text`: plain-text body fallback
   - `html`: styled Portal-tone recovery template

## Error Handling

1. If Portal URL is unavailable, use app base URL.
2. If brand name is unavailable, fall back to `Bailey` when possible, otherwise existing platform fallback.
3. If recipient email is missing, keep the existing validation error.
4. If SMTP is unavailable, keep existing debug mode behavior.
5. If HTML rendering fails, sending should fail rather than silently sending malformed content.

## Testing

Backend tests:

1. Chinese template subject, H1, CTA, status copy, and user-visible explanation are rendered.
2. English template subject, H1, CTA, status copy, and user-visible explanation are rendered.
3. `rootCause` is persisted but absent from customer-facing HTML and text.
4. `resolutionSummary` appears in the explanation block.
5. HTML contains a Portal CTA link to Portal home.
6. Plain-text fallback remains available.

Frontend tests or focused verification:

1. Modal labels clarify internal root cause versus customer-visible explanation.
2. Switching language updates subject/body to the selected template.
3. Editing user-visible explanation updates the relevant body section.
4. Email body helper text explains styled HTML wrapping.

Production verification after implementation:

1. Send Chinese sample email to `like@baicells.com` using a real service recovery case template without test wording.
2. Send English sample email to `like@baicells.com` using the same case template without test wording.
3. Confirm the test send does not mark the real case as notified unless explicitly sent through the case action.

