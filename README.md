# Agent Studio

Agent Studio is a multi-tenant web workspace for running OpenAI Codex-backed assistant sessions with enterprise controls. It combines a customer-facing assistant portal, an internal administration console, managed knowledge resources, runtime capability governance, integrations, access review workflows, and operational audit tooling.

The project is designed for teams that want an AI assistant experience that is usable by external customers while still giving internal operators control over access, models, resources, subscriptions, and compliance evidence.

## Features

- **Assistant portal**: persistent chat threads, file attachments, runtime options, feedback capture, public share snapshots, and organization-aware access.
- **Administration console**: platform overview, conversation audit, API usage audit, product feedback review, subscriptions, access requests, users, organizations, departments, broadcasts, and RBAC.
- **Capability center**: agent modes, run profiles, skill packages, model defaults, reasoning-effort defaults, and workspace instruction sources.
- **Resource center**: managed-upload knowledge sets, file trees, file preview/content routes, resource policies, and organization-scoped runtime access.
- **Integrations**: OpenAI Codex local auth, OpenAI API key mode, Azure OpenAI mode, DingTalk sign-in and org sync, Zendesk workflows, and OpenAI-compatible external API usage tracking.
- **Operations tooling**: Prisma migrations, local development bootstrap, Ubuntu install/deploy scripts, PM2/Caddy templates, health checks, environment checks, and diagnostics.

## Tech Stack

- **Frontend**: React, Vite, TypeScript, assistant-ui, Ant Design, lucide-react
- **Backend**: Node.js, Express, TypeScript, Prisma, PostgreSQL
- **AI runtime**: `@openai/codex-sdk`
- **Local services**: Docker Compose for PostgreSQL
- **Production helpers**: PM2, Caddy, shell deployment scripts

## Repository Layout

```text
.
|-- agent-api/              # Express API, Prisma schema, runtime services
|-- agent-ui/               # React/Vite web app
|-- docker-compose.dev.yml  # Local PostgreSQL service
|-- docs/                   # Operator and customer-facing docs
|-- scripts/                # Local dev, install, deploy, health, and diagnostic scripts
|-- templates/              # Caddy, PM2, env, and AGENTS.md templates
|-- sessions/               # Local runtime session workspace root, gitignored by default
`-- temp/                   # Local runtime/temp data, gitignored by default
```

## Prerequisites

- Node.js 22 or newer
- npm
- Docker with Docker Compose
- PostgreSQL, if you do not use the bundled local Docker Compose service
- An available Codex/OpenAI provider:
  - server-local Codex/ChatGPT auth, or
  - OpenAI API key, or
  - Azure OpenAI endpoint, API version, and API key

## Quick Start

Clone the repository and install dependencies:

```bash
git clone <your-repo-url> agent-studio
cd agent-studio
npm --prefix agent-api install
npm --prefix agent-ui install
```

Start the full local development stack:

```bash
node scripts/start-local-dev.mjs
```

The script will:

- create/update `agent-api/.env` with local defaults
- start PostgreSQL from `docker-compose.dev.yml`
- generate the Prisma client
- apply database migrations
- seed a local admin user, customer organization, default run profile, and default agent mode
- start the API and UI dev servers when their ports are free

Open:

- UI: `http://127.0.0.1:5173/`
- API: `http://127.0.0.1:8787/`

Default local sign-in:

- Email: `admin@local.agent-studio.test`
- Verification code: read the API console line labeled `[email-login-code]`

## Manual Local Setup

If you prefer to run each service separately:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
cp agent-api/.env.example agent-api/.env
cp agent-ui/.env.example agent-ui/.env
npm --prefix agent-api run prisma:generate
npm --prefix agent-api run prisma:migrate:deploy
npm --prefix agent-api run dev:seed
npm --prefix agent-api run dev
```

In a second terminal:

```bash
npm --prefix agent-ui run dev -- --host 127.0.0.1 --port 5173
```

## Configuration

Backend configuration lives in `agent-api/.env`. The most important settings are:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by Prisma |
| `PORT` / `HOST` | API bind address |
| `DEFAULT_MODEL` | Default model for new runtime sessions |
| `DEFAULT_REASONING_EFFORT` | Default reasoning effort for supported models |
| `DEFAULT_WORKSPACE` | Default filesystem workspace used by runtime sessions |
| `WORKSPACE_WHITELIST` | Comma-separated workspace roots the API may access |
| `SESSION_WORKSPACE_ROOT` | Root directory for per-session workspaces |
| `SESSION_COOKIE_SECRET` | Secret for signed session cookies |
| `APP_BASE_URL` | Public base URL used in links and emails |
| `SMTP_*` / `AUTH_EMAIL_FROM` | Email delivery settings |
| `DINGTALK_*` | DingTalk OAuth, alerting, and org-sync settings |
| `ACCESS_REQUEST_*` | Public access request and purchase-proof upload settings |
| `UPLOAD_TEMP_ROOT` | Temporary uploaded attachment root |
| `BRANDING_ASSET_ROOT` | Runtime branding asset root |
| `KNOWLEDGE_SET_STORAGE_ROOT` | Managed knowledge-set file root |
| `CODEX_BASE_HOME` | Base Codex home used for local-auth provider mode |
| `CODEX_SESSION_HOME_ROOT` | Per-session Codex home root |

Frontend configuration lives in `agent-ui/.env` or `agent-ui/.env.production`:

| Variable | Purpose |
| --- | --- |
| `VITE_AGENT_API_BASE` | API origin. In local dev this can be `http://127.0.0.1:8787`; in same-origin production it can be empty. |
| `VITE_AGENT_API_TOKEN` | Optional bearer token when API token protection is enabled. |

Never commit real `.env` files, API keys, provider credentials, SMTP passwords, or local Codex auth data.

## Common Commands

```bash
# Backend
npm --prefix agent-api run dev
npm --prefix agent-api run build
npm --prefix agent-api run test
npm --prefix agent-api run prisma:generate
npm --prefix agent-api run prisma:migrate:deploy
npm --prefix agent-api run dev:seed

# Frontend
npm --prefix agent-ui run dev
npm --prefix agent-ui run build
npm --prefix agent-ui run test
```

## Verification

Run the main build and test checks before publishing changes:

```bash
npm --prefix agent-api run build
npm --prefix agent-api run test
npm --prefix agent-ui run build
npm --prefix agent-ui run test
```

For a running API:

```bash
curl --fail http://127.0.0.1:8787/healthz
```

For deployed environments, the repository also includes:

```bash
scripts/check-env.sh
scripts/doctor.sh
```

## Production Deployment

The repository includes Ubuntu-oriented deployment helpers:

- `scripts/install-ubuntu.sh` provisions a host for Agent Studio.
- `scripts/deploy-agent-studio.sh` updates and rebuilds an existing deployment.
- `scripts/check-env.sh` validates deployed files, env, PostgreSQL, PM2, Caddy, health, and Codex runtime.
- `scripts/doctor.sh` collects broader deployment diagnostics.

The production layout expected by the scripts is configurable through environment variables, with defaults centered around:

- repository root: `/usr/local/agent-studio`
- app user: `agentstudio`
- backend: PM2 app `agent-studio-api`
- frontend: static Vite build served by Caddy
- API health endpoint: `/healthz`

Before deploying publicly, configure a real domain, HTTPS, secure cookies, SMTP delivery, provider credentials, durable upload/storage paths, and a production PostgreSQL database.

## Public Access Flow

Agent Studio supports an external customer access workflow:

1. A customer submits a trial/access request.
2. The request can include purchase-proof files.
3. Internal reviewers inspect the request and attached proof files.
4. Approved requests can provision an organization, subscription grant, user invite, and sign-in path.
5. The customer signs in with email verification and enters the organization-scoped portal.

The customer-facing quick start is available in `docs/external-customer-quickstart.md`.

## Security Notes

- Keep `WORKSPACE_WHITELIST` narrow. It defines the filesystem area runtime sessions may use.
- Use strong `SESSION_COOKIE_SECRET` values and secure cookies in production.
- Store upload roots, branding assets, knowledge sets, and session homes on durable storage outside disposable build directories.
- Treat local Codex auth, API keys, Azure keys, SMTP credentials, and integration secrets as production secrets.
- Review RBAC and resource policies before granting access to external organizations.

## License

No license file is included yet. Add a license before publishing this repository as open source.
