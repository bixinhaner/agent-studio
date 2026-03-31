# Private Repository Deploy Key Setup

The deployment automation assumes the GitHub repository stays private.

## Why deploy keys

Use a read-only deploy key instead of making the repository public or embedding a personal access token on the server.

Benefits:

- repository can remain private
- access is scoped to a single repository
- the server only gets read access

## Guided flow

When `scripts/install-ubuntu.sh` does not find a usable checkout, it can:

1. generate an SSH deploy key for the `agentstudio` runtime user
2. print the public key path and public key contents
3. stop before clone at a safe checkpoint

Default key location:

- `/home/agentstudio/.ssh/id_ed25519_agent_studio_deploy`

At that point:

1. open the GitHub repository settings
2. go to `Deploy keys`
3. add the public key
4. keep it read-only
5. re-run the installer

## Manual clone example

After the deploy key is registered, the repository clone should work with an SSH URL like:

```bash
git clone git@github.com:OWNER/REPO.git
```

## Operational notes

- keep the deploy key owned by `agentstudio`
- do not reuse the same deploy key across unrelated repositories
- if the key is rotated, re-run the installer and then re-run deploys with `scripts/deploy-agent-studio.sh`
