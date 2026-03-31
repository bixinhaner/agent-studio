# Agent Studio Installer Bootstrap Design

## Goal

Upgrade the Ubuntu installer into a practical near-zero-touch bootstrapper for single-host deployments so that a typical operator can run `sudo bash scripts/install-ubuntu.sh` from the repository root and let the script complete system setup, application bootstrap, and first deploy with minimal prompts.

## Scope

This spec changes only deployment automation behavior. It does not change the application runtime architecture, data model, or product features.

In scope:
- installer default repository detection and clone behavior
- automatic system package installation on Ubuntu
- automatic PostgreSQL role/database bootstrap
- zero-argument install defaults optimized for `/usr/local/agent-studio`
- resumable state updates so skipped clone does not block valid local repo installs
- documentation and verification updates required by the installer behavior changes

Out of scope:
- Docker or container deployment
- SQLite support
- automatic Codex authentication login flows
- multi-host orchestration
- cloud-specific provisioning

## Target Operator Experience

Default intended usage:

```bash
sudo bash scripts/install-ubuntu.sh
```

Expected behavior:
- if the current working directory is already a valid git repository, the installer uses it as the repository checkout
- if the current working directory is not a valid git repository, the installer defaults to `/usr/local/agent-studio` as the repository directory
- if no usable checkout exists, the installer offers guided clone behavior, including deploy-key guidance for private repositories
- the installer installs required system dependencies itself
- the installer initializes PostgreSQL role and database itself
- the installer writes application env files, renders Caddy config, performs the first deploy, and starts PM2
- Codex runtime authentication is validated only if available; missing authentication is reported clearly but the installer does not pretend it can complete that setup automatically

## Repository Resolution Rules

The installer must resolve the repository directory in this order:

1. explicit `--repo-dir` argument
2. current working directory, if it is a valid git work tree
3. `/usr/local/agent-studio`

Behavioral rules:
- if the resolved directory is already a valid git work tree, mark `repo_clone` complete without requiring clone
- if the resolved directory is not a usable checkout, use it as the target clone directory
- if the operator declines clone but the resolved directory is already a usable checkout, continue with downstream phases
- the installer must no longer assume `/usr/local/agent-studio/app/agent-studio` as the default repository layout

## Root Execution Model

The installer is now explicitly a root-run bootstrapper.

Rules:
- it should fail early with a clear message if not run as root
- system-level steps run directly as root
- application build/deploy steps still run as the dedicated app user via helper wrappers
- generated repository files and runtime files must still end up owned by the app user where appropriate

## Automatic Ubuntu Dependency Installation

The installer must automatically install required Ubuntu packages when missing.

Required packages:
- `git`
- `curl`
- `ca-certificates`
- `build-essential`
- `python3`
- `openssl`
- `unzip`
- `postgresql`
- `postgresql-contrib`
- `caddy`

Node/PM2 requirements:
- install Node.js 22 from NodeSource if `node` is missing or major version is not 22
- install PM2 globally if `pm2` is missing

Behavior:
- package installation must be idempotent
- package install results must be recorded in installer state
- failures must leave actionable pending status, not partial silent success

## PostgreSQL Bootstrap

The installer must do more than probe PostgreSQL.

Required behavior:
- ensure PostgreSQL service is installed and available
- ensure PostgreSQL service is running
- ensure application role exists
- ensure application database exists
- if no database password is provided, generate a strong random password
- write the resulting database credentials into the backend env file

Defaults:
- database name: `agent_studio`
- role name: `agentstudio`

Password behavior:
- prompt once for an explicit password only if the operator chooses to override the generated default
- otherwise generate a strong password automatically using a cryptographically strong source
- never print the generated password in clear text during normal logs
- persist only the redacted state summary, while writing the actual password to the backend env file

## Clone and Deploy-Key Behavior

Clone should no longer be a common blocker for operators who already have the repository locally.

Rules:
- if current directory is a valid checkout, no clone is needed
- if clone is needed and the operator chooses a private repository path, the existing deploy-key checkpoint flow remains valid
- if clone is skipped and no usable repository exists, only then should downstream phases stay pending
- the `--no-clone` flag remains supported for advanced users, but zero-argument installs should not require understanding or using it

## Default Prompting Strategy

The installer should prefer automatic decisions with minimal prompts.

Prompt only for:
- public domain for Caddy, when unavailable
- repository URL, only if clone is needed and none can be inferred
- optional PostgreSQL password override, if operator explicitly wants manual control
- deploy-key consent if clone requires private repo access
- Codex runtime validation timing, if validation would otherwise fail noisily

For everything else:
- prefer safe defaults
- continue automatically
- record the resulting state

## Codex Runtime Handling

Codex runtime setup remains intentionally conservative.

Rules:
- the installer may validate Codex runtime availability
- the installer must not claim it can automatically complete Codex user authentication
- missing Codex auth must be reported as a clear follow-up action
- installation should still succeed when all non-Codex platform setup is complete, even if Codex auth remains pending

## State Model Changes

The installer state file remains at `/usr/local/agent-studio/install-state.json` by default.

New/updated expectations:
- repository resolution source should be recorded
- system dependency install status should be recorded
- Node.js install status should be recorded
- PM2 install status should be recorded
- PostgreSQL bootstrap status should include service/role/database sub-status
- existing usable checkout must map to `repo_clone=complete`
- downstream phases must only remain blocked if a real prerequisite is absent, not because clone was skipped in a now-valid local checkout scenario

## Script and Template Impact

Files expected to change:
- `scripts/install-ubuntu.sh`
- `scripts/lib/common.sh`
- `templates/agent-api.env.template`
- `temp/verify-install-script.sh`
- `docs/deployment/ubuntu-caddy-pm2.md`
- `docs/deployment/troubleshooting.md`

Possible small changes:
- `scripts/check-env.sh` if wording or assumptions need to reflect the stronger installer behavior

## Verification Expectations

Updated installer verification must cover:
- default current-directory repo detection
- fallback clone target `/usr/local/agent-studio`
- system dependency installation path behavior via dry or simulated checks where practical
- PostgreSQL bootstrap state behavior
- valid local repo with clone skipped not blocking env generation or first deploy
- help output still valid
- resumable state still valid after reruns

## Risks and Constraints

Main risk areas:
- package installation commands are environment-sensitive and must fail clearly
- PostgreSQL bootstrap must be careful not to overwrite valid existing credentials blindly
- changing default repo assumptions can break older state resumes unless state migration is handled deliberately
- root-run bootstrap must still preserve correct ownership for app-managed files

## Recommendation

Implement this as an evolution of the existing installer, not a new script. Preserve the resumable state model, but make current-directory repo detection, system dependency installation, and PostgreSQL bootstrap first-class behaviors so the installer matches operator expectations for a one-command Ubuntu deployment.
