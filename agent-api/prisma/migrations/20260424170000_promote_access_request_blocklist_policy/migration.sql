WITH defaults AS (
  SELECT ARRAY[
    '126.com',
    '163.com',
    'aliyun.com',
    'aol.com',
    'foxmail.com',
    'gmail.com',
    'hotmail.com',
    'icloud.com',
    'live.com',
    'msn.com',
    'outlook.com',
    'proton.me',
    'protonmail.com',
    'qq.com',
    'sina.com',
    'sohu.com',
    'yahoo.com',
    'ymail.com'
  ]::TEXT[] AS domains
)
UPDATE "access_request_policies" AS arp
SET "public_email_blocklist_extra" = ARRAY(
  SELECT domain
  FROM (
    SELECT DISTINCT lower(trim(value)) AS domain
    FROM defaults,
    unnest(COALESCE(arp."public_email_blocklist_extra", ARRAY[]::TEXT[]) || defaults.domains) AS value
  ) AS merged
  WHERE domain <> ''
  ORDER BY domain
);
