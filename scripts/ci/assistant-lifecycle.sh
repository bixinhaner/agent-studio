#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../agent-api"
npm ci --no-audit --no-fund
npx prisma generate
npm run build
# Only for the disposable CI/test database, never an application database.
if [[ -n "${ASSISTANT_TEST_DATABASE_URL:-}" ]]; then
  DATABASE_URL="$ASSISTANT_TEST_DATABASE_URL" npx prisma db push --skip-generate
fi
npm run test -- src/integrations/action-connector
