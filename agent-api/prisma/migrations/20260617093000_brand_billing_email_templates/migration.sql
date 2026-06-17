UPDATE "billing_email_rules"
SET
  "subject" = '{{brand_name}} subscription expires in 14 days',
  "body_text" = 'Your {{brand_name}} subscription for {{company_name}} expires on {{expires_at_local}}. Open billing to renew securely: {{renew_url}}',
  "body_html" = $html$
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;margin:0;padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d9e0ea;border-collapse:collapse;">
            <tr>
              <td style="padding:28px 32px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <div style="font-size:12px;line-height:18px;color:#5b6472;font-weight:bold;letter-spacing:0;text-transform:uppercase;">{{brand_name}}</div>
                <h1 style="margin:10px 0 0;font-size:24px;line-height:32px;font-weight:bold;color:#111827;">Subscription expires in 14 days</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;font-family:Arial,Helvetica,sans-serif;color:#374151;">
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">Your {{brand_name}} subscription for <strong>{{company_name}}</strong> expires on <strong>{{expires_at_local}}</strong>.</p>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#5b6472;">Open billing to review your current plan and continue with secure payment.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td bgcolor="#ff4614" style="background:#ff4614;">
                      <a href="{{renew_url}}" style="display:inline-block;padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:#ffffff;text-decoration:none;">Renew subscription</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
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
WHERE "id" = 'billing-email-rule-expiring-14';

UPDATE "billing_email_rules"
SET
  "subject" = '{{brand_name}} subscription expires in 7 days',
  "body_text" = 'Your {{brand_name}} subscription for {{company_name}} expires on {{expires_at_local}}. Open billing to renew securely: {{renew_url}}',
  "body_html" = $html$
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;margin:0;padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d9e0ea;border-collapse:collapse;">
            <tr>
              <td style="padding:28px 32px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <div style="font-size:12px;line-height:18px;color:#5b6472;font-weight:bold;text-transform:uppercase;">{{brand_name}}</div>
                <h1 style="margin:10px 0 0;font-size:24px;line-height:32px;font-weight:bold;color:#111827;">Subscription expires in 7 days</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;font-family:Arial,Helvetica,sans-serif;color:#374151;">
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">Your {{brand_name}} subscription for <strong>{{company_name}}</strong> expires on <strong>{{expires_at_local}}</strong>.</p>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#5b6472;">Renew before the end date to keep AI access available for your team.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td bgcolor="#ff4614" style="background:#ff4614;">
                      <a href="{{renew_url}}" style="display:inline-block;padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:#ffffff;text-decoration:none;">Renew subscription</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
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
WHERE "id" = 'billing-email-rule-expiring-7';

UPDATE "billing_email_rules"
SET
  "subject" = '{{brand_name}} subscription expires tomorrow',
  "body_text" = 'Your {{brand_name}} subscription for {{company_name}} expires on {{expires_at_local}}. Open billing to renew securely: {{renew_url}}',
  "body_html" = $html$
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;margin:0;padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d9e0ea;border-collapse:collapse;">
            <tr>
              <td style="padding:28px 32px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <div style="font-size:12px;line-height:18px;color:#5b6472;font-weight:bold;text-transform:uppercase;">{{brand_name}}</div>
                <h1 style="margin:10px 0 0;font-size:24px;line-height:32px;font-weight:bold;color:#111827;">Subscription expires tomorrow</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;font-family:Arial,Helvetica,sans-serif;color:#374151;">
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">Your {{brand_name}} subscription for <strong>{{company_name}}</strong> expires on <strong>{{expires_at_local}}</strong>.</p>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#5b6472;">Renew now to avoid interruption to new AI requests.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td bgcolor="#ff4614" style="background:#ff4614;">
                      <a href="{{renew_url}}" style="display:inline-block;padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:#ffffff;text-decoration:none;">Renew subscription</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
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
WHERE "id" = 'billing-email-rule-expiring-1';

UPDATE "billing_email_rules"
SET
  "subject" = '{{brand_name}} subscription has expired',
  "body_text" = 'Your {{brand_name}} subscription for {{company_name}} expired on {{expires_at_local}}. Open billing to renew securely: {{renew_url}}',
  "body_html" = $html$
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;margin:0;padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d9e0ea;border-collapse:collapse;">
            <tr>
              <td style="padding:28px 32px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <div style="font-size:12px;line-height:18px;color:#5b6472;font-weight:bold;text-transform:uppercase;">{{brand_name}}</div>
                <h1 style="margin:10px 0 0;font-size:24px;line-height:32px;font-weight:bold;color:#111827;">Subscription has expired</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;font-family:Arial,Helvetica,sans-serif;color:#374151;">
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">Your {{brand_name}} subscription for <strong>{{company_name}}</strong> expired on <strong>{{expires_at_local}}</strong>.</p>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#5b6472;">Open billing to renew the workspace and restore new AI requests.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td bgcolor="#ff4614" style="background:#ff4614;">
                      <a href="{{renew_url}}" style="display:inline-block;padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:#ffffff;text-decoration:none;">Renew access</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
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
WHERE "id" = 'billing-email-rule-expired-0';

UPDATE "billing_email_rules"
SET
  "subject" = '{{brand_name}} automatic renewal failed',
  "body_text" = 'Automatic renewal for {{company_name}} was not completed. Open billing to update payment and renew securely: {{renew_url}}',
  "body_html" = $html$
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;margin:0;padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d9e0ea;border-collapse:collapse;">
            <tr>
              <td style="padding:28px 32px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <div style="font-size:12px;line-height:18px;color:#5b6472;font-weight:bold;text-transform:uppercase;">{{brand_name}}</div>
                <h1 style="margin:10px 0 0;font-size:24px;line-height:32px;font-weight:bold;color:#111827;">Automatic renewal was not completed</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;font-family:Arial,Helvetica,sans-serif;color:#374151;">
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">Automatic renewal for <strong>{{company_name}}</strong> was not completed.</p>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#5b6472;">Open billing to update payment and continue secure renewal.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td bgcolor="#ff4614" style="background:#ff4614;">
                      <a href="{{renew_url}}" style="display:inline-block;padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:#ffffff;text-decoration:none;">Open billing</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
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
