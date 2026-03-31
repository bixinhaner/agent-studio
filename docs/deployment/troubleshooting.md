# Deployment Troubleshooting

## Installer stops after deploy key generation

Expected behavior.

Action:

1. copy the generated public key
2. add it to GitHub as a deploy key
3. rerun `scripts/install-ubuntu.sh`

## Repository clone stays skipped

Common causes:

- `--no-clone` was used
- target directory is not a valid Git checkout
- deploy key has not been registered

Check:

```bash
bash scripts/doctor.sh
```

## `prisma migrate deploy` fails

Common causes:

- PostgreSQL is not reachable
- `DATABASE_URL` is wrong
- the database or role was not created

Check:

```bash
bash scripts/check-env.sh --skip-codex-check
```

## PM2 restart fails

Common causes:

- `agent-api/dist` has not been built
- `pm2` is not installed for the runtime user
- the ecosystem file is stale

Check:

```bash
pm2 status
bash scripts/doctor.sh
```

## Health endpoint fails

Check:

```bash
curl -v http://127.0.0.1:8787/healthz
caddy validate --config /etc/caddy/Caddyfile
```

## Codex runtime validation fails

This deployment path relies on the server user's default Codex/OpenAI authentication environment.

Common causes:

- the `agentstudio` user does not have a valid Codex auth context
- the runtime process is being started under the wrong user

Check:

```bash
bash scripts/check-env.sh
```

## Need a full snapshot

Run:

```bash
bash scripts/doctor.sh
```

That collects:

- PM2 status
- PM2 logs
- API health probe
- Caddy validation
- PostgreSQL connectivity probe
- Codex runtime validation
- `journalctl` output for Caddy
