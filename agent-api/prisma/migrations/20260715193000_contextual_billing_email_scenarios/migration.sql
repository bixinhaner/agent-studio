UPDATE "billing_email_rules"
SET
  "subject" = '{{brand_name}} {{email_subject_suffix}}',
  "body_text" = replace(
    "body_text",
    E'\n\nReview billing:',
    E'\n{{plan_options_text}}\nReview billing:'
  ),
  "body_html" = replace(
    "body_html",
    '{{renewal_summary}}</p>',
    '{{renewal_summary}}</p>{{plan_options_html}}'
  ),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'billing-email-rule-expiring-14',
  'billing-email-rule-expiring-7',
  'billing-email-rule-expiring-1',
  'billing-email-rule-expired-0',
  'billing-email-rule-auto-renew-failed-0'
);
