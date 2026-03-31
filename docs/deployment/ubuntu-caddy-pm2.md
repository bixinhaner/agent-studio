# Ubuntu Deployment with Caddy and PM2

This repository ships a resumable Ubuntu deployment flow for single-host production installs.

## Topology

- `Caddy` terminates HTTPS and serves the built `agent-ui` assets
- `PM2` runs the `agent-api` Node process as the dedicated `agentstudio` user
- `PostgreSQL` stores application state
- application code and data live under `/usr/local/agent-studio`

## Initial install

1. Prepare an Ubuntu host with `sudo` access.
2. Run the guided installer:

```bash
cd /path/to/agent-studio
bash scripts/install-ubuntu.sh
```

3. If the repository has not been cloned yet, the installer will generate a deploy key and stop at a safe checkpoint.
4. Add the generated public key to GitHub as a read-only deploy key.
5. Re-run `scripts/install-ubuntu.sh` until all required steps are marked complete.

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
