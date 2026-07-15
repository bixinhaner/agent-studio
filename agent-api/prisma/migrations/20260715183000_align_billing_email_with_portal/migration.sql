UPDATE "billing_email_rules"
SET
  "audience_json" = jsonb_set(COALESCE("audience_json", '{}'::jsonb), '{salesContact}', 'false'::jsonb, true),
  "subject" = CASE "id"
    WHEN 'billing-email-rule-expiring-14' THEN '{{brand_name}} access ends in 14 days'
    WHEN 'billing-email-rule-expiring-7' THEN '{{brand_name}} access ends in 7 days'
    WHEN 'billing-email-rule-expiring-1' THEN '{{brand_name}} access ends tomorrow'
    WHEN 'billing-email-rule-expired-0' THEN '{{brand_name}} access has ended'
    ELSE "subject"
  END,
  "body_text" = E'{{email_heading}}\n\nThe access end date for {{plan_name}} at {{company_name}} is {{access_end_date}}.\n\n{{renewal_summary}}\n\nReview billing: {{renew_url}}',
  "body_html" = $html$
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f6f8;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;margin:0;padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d9e0ea;border-radius:12px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <div style="font-size:12px;line-height:18px;color:#5b6472;font-weight:bold;text-transform:uppercase;">{{brand_name}}</div>
                <h1 style="margin:8px 0 0;font-size:24px;line-height:32px;font-weight:bold;color:#111827;">{{email_heading}}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;font-family:Arial,Helvetica,sans-serif;color:#374151;">
                <p style="margin:0 0 12px;font-size:15px;line-height:24px;">The access end date for <strong>{{plan_name}}</strong> at <strong>{{company_name}}</strong> is <strong>{{access_end_date}}</strong>.</p>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#5b6472;">{{renewal_summary}}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td bgcolor="#ff4614" style="background:#ff4614;border-radius:8px;">
                      <a href="{{renew_url}}" style="display:inline-block;padding:13px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:#ffffff;text-decoration:none;">Review billing</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
                <p style="margin:0 0 10px;font-size:12px;line-height:18px;">Billing shows the current annual price and renewal setting before you continue.</p>
                <p style="margin:0;font-size:12px;line-height:18px;">If the button does not work, copy and paste this link into your browser:<br><a href="{{renew_url}}" style="color:#ff4614;text-decoration:underline;">{{renew_url}}</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
$html$,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'billing-email-rule-expiring-14',
  'billing-email-rule-expiring-7',
  'billing-email-rule-expiring-1',
  'billing-email-rule-expired-0'
);

UPDATE "billing_email_rules"
SET
  "audience_json" = jsonb_set(COALESCE("audience_json", '{}'::jsonb), '{salesContact}', 'false'::jsonb, true),
  "subject" = '{{brand_name}} automatic renewal payment needs attention',
  "body_text" = E'{{email_heading}}\n\nThe automatic renewal for {{plan_name}} at {{company_name}} was not completed on {{renewal_date}}.\n\n{{renewal_summary}}\n\nReview billing: {{renew_url}}',
  "body_html" = $html$
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f6f8;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;margin:0;padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d9e0ea;border-radius:12px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <div style="font-size:12px;line-height:18px;color:#5b6472;font-weight:bold;text-transform:uppercase;">{{brand_name}}</div>
                <h1 style="margin:8px 0 0;font-size:24px;line-height:32px;font-weight:bold;color:#111827;">{{email_heading}}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;font-family:Arial,Helvetica,sans-serif;color:#374151;">
                <p style="margin:0 0 12px;font-size:15px;line-height:24px;">The automatic renewal for <strong>{{plan_name}}</strong> at <strong>{{company_name}}</strong> was not completed on <strong>{{renewal_date}}</strong>.</p>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#5b6472;">{{renewal_summary}}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td bgcolor="#ff4614" style="background:#ff4614;border-radius:8px;">
                      <a href="{{renew_url}}" style="display:inline-block;padding:13px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:#ffffff;text-decoration:none;">Review billing</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
                <p style="margin:0 0 10px;font-size:12px;line-height:18px;">Billing shows the payment status and renewal options before you continue.</p>
                <p style="margin:0;font-size:12px;line-height:18px;">If the button does not work, copy and paste this link into your browser:<br><a href="{{renew_url}}" style="color:#ff4614;text-decoration:underline;">{{renew_url}}</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
$html$,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'billing-email-rule-auto-renew-failed-0';
