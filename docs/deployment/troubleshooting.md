# Deployment Troubleshooting

## Installer says it must be run as root

Expected for the zero-argument bootstrap path.

Run:

```bash
sudo bash scripts/install-ubuntu.sh
```

## Installer stopped after deploy key generation

Expected behavior for a private repository clone checkpoint.

Action:

1. copy the generated public key
2. add it to GitHub as a read-only deploy key
3. rerun `scripts/install-ubuntu.sh`

## Installer did not clone the repository

The installer now prefers the current working directory when it is already a valid Git checkout. It only clones when no usable local checkout exists.

Check:

```bash
git rev-parse --is-inside-work-tree
```

If this prints `true`, rerun the installer from that checkout.

## PostgreSQL bootstrap fails

Common causes:

- the host is not Ubuntu
- PostgreSQL service failed to start
- local package mirrors are unavailable

Check:

```bash
bash scripts/check-env.sh --skip-codex-check
systemctl status postgresql
```

## PM2 restart fails

Common causes:

- first deploy did not finish
- `agent-api/dist` has not been built
- PM2 startup registration needs another rerun after package install

Check:

```bash
runuser -u agentstudio -- pm2 status
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
