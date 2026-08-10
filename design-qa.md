# Product Feedback Reply Design QA

## Comparison Target

- Source visual truth:
  - `temp/design/product-feedback-reply/06-image-selection.png`
  - `temp/design/product-feedback-reply/07-preview-with-image.png`
- Browser-rendered implementation:
  - `temp/design/product-feedback-reply/implementation-02-edit.png`
  - `temp/design/product-feedback-reply/implementation-03-preview.png`
  - `temp/design/product-feedback-reply/implementation-04-success.png`
  - `temp/design/product-feedback-reply/implementation-05-failure.png`
- Combined comparison evidence:
  - `temp/design/product-feedback-reply/design-comparison-focused.png`
- Local implementation URL: `http://127.0.0.1:5191/`
- Browser: Chrome, existing user browser session
- CSS viewport: 1680 × 1058, device density 1
- Source pixels: 1672 × 941
- Implementation pixels: 1680 × 1058
- Normalization: implementation captures were center-cropped to 1672 × 941 for equal-pixel full-view comparison; focused comparisons use centered 900 × 900 crops from both source and normalized implementation.
- States: initial feedback detail, reply editor, original-image selection, HTML email preview with inline image, successful send/resolved, failed send/pending.

## Findings

No actionable P0, P1, or P2 findings remain.

- Fonts and typography: the implementation uses the existing Admin Console PingFang/SF/Helvetica stack and Ant Design control typography. Heading, label, helper, and body hierarchy remain readable at the target viewport. The HTML email uses the existing experience-follow-up Arial/Helvetica mail-safe stack.
- Spacing and layout rhythm: the final modal is 720 px wide, matching the existing Experience Follow-up email modal. Form sections follow the existing 12–14 px vertical rhythm. Persistent actions remain visible while the body scrolls on shorter viewports.
- Colors and visual tokens: the implementation intentionally uses the existing Admin Console blue primary token instead of the ImageGen mock's orange action color. Orange remains inside the recipient-facing Bailey email template. This preserves current Admin Console action semantics and keeps the email visually consistent with Experience Follow-up.
- Image quality and asset fidelity: feedback screenshots render from the original uploaded image, not a placeholder or redrawn asset. Email preview images keep aspect ratio, border, radius, and caption; SMTP delivery uses the same selected bytes as CID attachments.
- Copy and content: the editor explains HTML styling and plaintext fallback, image limits are explicit, and the status rule states that only confirmed email delivery resolves the feedback. Chinese and English templates are both available.

## Intentional Differences From ImageGen

- Admin actions use the existing blue Admin Console primary token; the mock used Bailey orange.
- The modal is 720 px rather than the mock's narrower approximation because it reuses the current Experience Follow-up modal width and must support a readable HTML preview.
- Original feedback images start unselected. This avoids silently including potentially sensitive screenshots; the mock illustrated a post-selection state.
- The recipient is read-only and comes from the feedback submitter, preventing the feature from becoming an arbitrary outbound-email relay.

## Comparison History

1. Initial edit implementation
   - Finding: [P2] The first implementation used a 760 px modal, drifting from the existing 720 px Experience Follow-up email modal.
   - Fix: changed `ProductFeedbackReplyModal` width to 720 px.
   - Post-fix evidence: `implementation-02-edit.png` and the focused edit comparison in `design-comparison-focused.png`.
2. Initial vertical layout
   - Finding: [P2] A content-heavy editor could push persistent actions below the viewport on shorter screens.
   - Fix: capped modal body height at `calc(100vh - 190px)` with body scrolling, leaving the action footer persistent.
   - Post-fix evidence: final edit and failure captures show the action footer visible while content remains scrollable.
3. Final comparison
   - Result: no remaining P0/P1/P2 visual or interaction findings.

## Primary Interactions Tested

- Open Reply and Resolve from the feedback detail header.
- Switch between Chinese and English template controls.
- Select an eligible original feedback screenshot.
- Open the real file chooser, add a supplemental PNG, and confirm the combined counter reaches 2/3.
- Generate and inspect the styled HTML email preview with one inline image.
- Send successfully, close the modal, show success feedback, record the reply, and update status to Resolved.
- Simulate SMTP failure, keep the modal content intact, show an actionable error, and keep feedback status Pending.
- Confirm recipient, subject, body, image count, language, and delivery status appear in reply history.

## Console Check

- No application console errors were observed during the tested flow.
- Chrome reported one unrelated Immersive Translate extension version-mismatch error; it is outside the application and did not affect the flow.

## Implementation Checklist

- [x] Reuse Experience Follow-up HTML email style.
- [x] Provide Chinese and English email templates.
- [x] Support original feedback images and supplemental uploads.
- [x] Enforce 3-image, 2 MB, PNG/JPG/GIF limits in UI and API.
- [x] Send CID inline images with plaintext fallback.
- [x] Record reply metadata without duplicating image bytes.
- [x] Resolve only after confirmed SMTP delivery.
- [x] Preserve pending status and editor contents on failure.
- [x] Verify success, failure, and preview states in Chrome.

## Follow-up Polish

- [P3] If Admin Console gains a global locale switch later, move the modal's administrative labels into that shared i18n layer. The recipient-facing email content is already bilingual.

final result: passed
