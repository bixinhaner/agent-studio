# Ubuntu Deployment with Caddy and PM2

This repository ships a resumable Ubuntu deployment flow for single-host production installs.

## Topology

- `Caddy` terminates HTTPS and serves the built `agent-ui` assets
- `PM2` runs the `agent-api` Node process as the dedicated `agentstudio` user
- `PostgreSQL` stores application state
- application code and data live under `/usr/local/agent-studio`

## Initial install

Run the installer as `root` from the repository checkout:

```bash
sudo bash scripts/install-ubuntu.sh
```

Default behavior:

- if the current working directory is already the Agent Studio Git checkout, the installer uses it directly
- otherwise it defaults the checkout target to `/usr/local/agent-studio`
- if a private repository must be cloned, the installer can generate a deploy key and stop at a safe checkpoint until the key is added in GitHub

The installer now performs the full host bootstrap:

- creates the `agentstudio` user
- creates `/usr/local/agent-studio` data directories
- installs system packages (`git`, `curl`, `nodejs`, `pm2`, `postgresql`, `caddy`, and common build/runtime tools)
- creates the PostgreSQL role and database automatically
- renders backend/frontend env files
- renders the Caddy configuration
- runs the first deploy
- starts PM2 and registers startup

## Ongoing deploys

After the first install, update the server with:

```bash
bash scripts/deploy-agent-studio.sh
```

That script performs:

- `git fetch` and `git pull --ff-only`
- backend dependency install
- `prisma generate`
- `prisma migrate deploy`
- backend build
- RBAC seed
- frontend build
- PM2 restart

## Validation

Use:

```bash
bash scripts/check-env.sh
```

That checks required files, PM2, Caddy, the API health endpoint, and Codex runtime validation.

## Diagnostics

If a deploy or runtime check fails, collect diagnostics with:

```bash
bash scripts/doctor.sh
```
