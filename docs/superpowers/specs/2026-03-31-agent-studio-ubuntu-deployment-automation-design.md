# Agent Studio Ubuntu Deployment Automation Design

Date: 2026-03-31
Branch: `codex/ubuntu-deployment-automation`
Status: Draft for review

## 1. Summary

This sub-project adds repository-native deployment automation for running Agent Studio on a single Ubuntu server.

The deployment target is intentionally constrained:
- Ubuntu single-host deployment
- `Caddy` for TLS and static hosting
- `PM2` for backend process management
- `PostgreSQL` for persistence
- application and data rooted at `/usr/local/agent-studio`
- private GitHub repository access through a guided deploy-key flow
- Codex/OpenAI runtime authentication inherited from the server user's default Codex environment

The deliverable is not just a one-shot installer. It is a resumable deployment toolchain stored in the repository, with:
- interactive install wizard
- CLI flag overrides
- update/deploy script
- environment/health checker
- diagnostics helper
- persisted install state so users can skip and resume configuration safely

## 2. Why This Is Needed

Current deployment requires too many manual steps and too much implicit project knowledge:
- system package installation is manual
- repository clone/update steps are manual
- environment file creation is manual
- RBAC seed must be remembered separately
- Prisma migration must be remembered separately on every update
- deploy-key setup for a private repo is not guided
- health checks and common diagnostics are not bundled with the project

That is workable for the developer who built the system, but it is not operationally robust.

This project closes that gap by making deployment a first-class repository capability.

## 3. Goals

This phase must deliver:
- a repository-hosted Ubuntu installation script
- support for first-time clone of a private GitHub repository using a guided deploy-key flow
- support for resuming an interrupted install using a state file
- support for interactive prompts with CLI flag overrides
- a repeatable update/deploy script for normal version upgrades
- a health-check script for environment validation and runtime verification
- a doctor script for common deployment failures
- generated config templates for backend, frontend, Caddy, and PM2
- automatic execution of Prisma migrations during deploy
- automatic idempotent RBAC seeding during deploy

## 4. Non-Goals

This phase does not include:
- Docker or Docker Compose deployment
- Kubernetes or multi-host deployment
- SQLite support
- non-Ubuntu Linux distributions
- Windows or macOS deployment automation
- automatic Codex OAuth or account login flows
- external secret vault integration
- approval or multi-operator deployment workflows

## 5. Deployment Model

### 5.1 Runtime Topology

The target production topology is:
- `Caddy`
  - serves `agent-ui/dist`
  - reverse-proxies `/api/*` to `agent-api`
  - terminates TLS
- `PM2`
  - runs the Node backend process
- `PostgreSQL`
  - stores application data
- filesystem storage under `/usr/local/agent-studio/data`
  - workspaces
  - session uploads
  - managed knowledge sets

### 5.2 Linux User Model

The deployment model is split by responsibility:
- `root` or `sudo`
  - install system packages
  - configure PostgreSQL
  - write `/etc/caddy/Caddyfile`
  - manage systemd-facing setup for `caddy` and PM2 startup wiring
- `agentstudio`
  - own `/usr/local/agent-studio`
  - clone and update the repository
  - install Node dependencies
  - run builds
  - execute Prisma migrations
  - run RBAC seed
  - own the PM2 application process
  - hold the default Codex runtime authentication environment

This split is required because the backend should not run as `root`, and the effective Codex runtime credentials are user-scoped.

## 6. Repository Layout

This phase introduces three deployment artifact areas.

### 6.1 Scripts

Create a new top-level `scripts/` toolchain:
- `scripts/install-ubuntu.sh`
  - interactive first-install and resume entry point
- `scripts/deploy-agent-studio.sh`
  - normal code update + build + migrate + restart
- `scripts/check-env.sh`
  - health and environment validation
- `scripts/doctor.sh`
  - common diagnostics
- `scripts/lib/common.sh`
  - shared shell helpers

### 6.2 Templates

Create a new top-level `templates/` directory:
- `templates/agent-api.env.template`
- `templates/agent-ui.env.production.template`
- `templates/Caddyfile.template`
- `templates/pm2-ecosystem.config.cjs.template`

### 6.3 Documentation

Create new deployment docs under `docs/deployment/`:
- Ubuntu deployment guide
- private-repo deploy-key guide
- troubleshooting guide

## 7. Install State Model

The install flow must be resumable.

State file path:
- `/usr/local/agent-studio/install-state.json`

The state file should record at minimum:
- whether `agentstudio` user exists
- whether base directories exist
- whether repository clone completed
- whether deploy key was generated
- whether PostgreSQL database/user was created
- whether backend `.env` was written
- whether frontend `.env.production` was written
- whether Caddy config was written
- whether first build completed
- whether PM2 app was started
- whether Codex runtime verification passed
- which steps were skipped intentionally

The installer must be idempotent and resumable:
- already-completed steps can be skipped automatically
- missing configuration can be left unresolved temporarily
- later reruns should pick up where the previous run stopped
- explicit CLI flags should allow overwriting or forcing a step

## 8. Install Wizard Behavior

### 8.1 Interaction Model

The installer must support:
- interactive prompts by default
- CLI flags to override prompt answers
- a mixed mode where some values come from CLI and the remainder are prompted

### 8.2 Safe Skip Behavior

If required values are unavailable during first run, the installer may allow the user to skip a step, but it must:
- record that step as incomplete or skipped
- print the exact follow-up action required
- exit at a safe checkpoint without leaving the repo in an unknown state

### 8.3 Private Repo Clone Guidance

If the repository is not present, the installer should:
- detect that a clone is needed
- generate an SSH deploy key if needed
- print the public key path and contents
- instruct the operator to add the key to GitHub as a deploy key
- pause for operator confirmation
- attempt the clone again once confirmed

The repository remains private. This project must not assume the repository becomes public.

## 9. Deploy Script Behavior

The update/deploy script must perform the routine upgrade path:
- fetch and fast-forward `main`
- install backend dependencies with `npm ci`
- generate Prisma client
- apply Prisma migrations with `prisma migrate deploy`
- build backend
- run idempotent RBAC seed
- install frontend dependencies with `npm ci`
- build frontend
- restart PM2 backend process
- persist PM2 state if needed

This is required because database migrations are not applied by simply restarting the backend.

## 10. Health Checks

`check-env.sh` must validate the deployment environment and runtime assumptions.

It should check:
- Ubuntu/package prerequisites
- Node/npm availability
- PostgreSQL connectivity
- existence and parseability of required env files
- Caddy config presence
- PM2 process status
- build artifacts presence
- backend health endpoint reachability when running
- Codex runtime provider validation under the effective app user

The Codex check is important because the live runtime uses the server user's default Codex environment rather than a project-local API key in the main chat execution path.

## 11. Diagnostics

`doctor.sh` should gather fast, actionable failure signals for common problems:
- missing system packages
- PostgreSQL auth or connectivity failures
- missing or malformed `.env`
- migration failures
- PM2 startup failures
- Caddy config validation failures
- missing build outputs
- Codex runtime validation failures
- DingTalk callback or cookie misconfiguration hints when same-origin assumptions are violated

This script is a troubleshooting helper, not a repair bot.

## 12. Configuration Boundaries

The deployment automation should template and manage:
- backend `.env`
- frontend `.env.production`
- Caddy config
- PM2 ecosystem config if that path is chosen for startup

The deployment automation should not automatically fill secrets that only the operator knows, such as:
- DingTalk client ID/secret
- database password
- session cookie secret
- deploy-key registration in GitHub
- Codex runtime login/auth state

## 13. Security Boundaries

The deployment automation must preserve these constraints:
- application runtime must not run as `root`
- filesystem paths written into config must be absolute paths under `/usr/local/agent-studio`
- backend and frontend should be deployed same-origin through Caddy
- secret-bearing config output should have restricted file permissions where appropriate
- the installer must not print secret values after writing them
- doctor/check scripts must redact obvious secret material when echoing config diagnostics

## 14. Success Criteria

This project is successful when:
- a new Ubuntu host can be prepared from the repository using the installer and guided prompts
- a private-repo clone can be completed with deploy-key guidance
- an interrupted install can be resumed without manual cleanup
- normal version upgrades are reduced to a single deploy command
- RBAC seed and Prisma migration no longer require operators to remember extra commands
- health and diagnostics can confirm or narrow failures quickly
- the deployed runtime still uses the server user's default Codex environment, matching current local behavior
