# Agent Studio Installer Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Ubuntu installer so a typical operator can run `sudo bash scripts/install-ubuntu.sh` with little or no extra arguments and complete a single-host deployment end-to-end.

**Architecture:** Evolve the existing resumable installer instead of replacing it. Keep the state-file model and existing helper library, but promote current-directory repo detection, Ubuntu dependency installation, PostgreSQL bootstrap, and safer default repo semantics to first-class phases. Preserve the current split between root-only system steps and app-user runtime steps.

**Tech Stack:** Bash, Ubuntu apt/dpkg tooling, NodeSource install flow for Node.js 22, PM2, PostgreSQL, existing deployment helper scripts, existing verifier scripts under `temp/`.

---

## File Structure

### Core scripts
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh`
  - Add root enforcement, current-directory repo detection, dependency installation, PostgreSQL bootstrap, and zero-argument defaults
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/lib/common.sh`
  - Add reusable helpers for Ubuntu package checks/installation, service checks, password generation, and root assertions
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/check-env.sh`
  - Align wording/assumptions with new installer defaults where needed

### Templates
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/agent-api.env.template`
  - Ensure installer can safely render generated PostgreSQL credentials and `/usr/local/agent-studio` defaults

### Verification
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-install-script.sh`
  - Add coverage for cwd repo detection, fallback repo target, dependency/bootstrap state, and non-blocking clone semantics

### Docs
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/ubuntu-caddy-pm2.md`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/troubleshooting.md`

### References
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/superpowers/specs/2026-03-31-agent-studio-installer-bootstrap-design.md`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/lib/common.sh`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/agent-api.env.template`

---

### Task 1: Add Root Bootstrap Preconditions and Repo Resolution Defaults

**Files:**
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/lib/common.sh`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-install-script.sh`

- [ ] **Step 1: Extend the verifier to assert zero-argument repo resolution behavior**

```bash
# Add checks for:
# - current working directory repo detection markers in install-ubuntu.sh
# - fallback /usr/local/agent-studio default
# - root enforcement marker
```

- [ ] **Step 2: Run the verifier to see the new assertions fail**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-install-script.sh
```

Expected:
- FAIL because the new zero-argument behavior is not implemented yet

- [ ] **Step 3: Add root enforcement and repo resolution helpers**

Implement in `scripts/lib/common.sh` helpers for:
- `require_root_shell`
- `cwd_is_git_checkout`
- `resolve_default_repo_dir`

Implement in `scripts/install-ubuntu.sh`:
- fail early unless `id -u` is `0`
- if `--repo-dir` is absent and current working directory is a valid checkout, set `REPO_DIR` to `pwd -P`
- otherwise default `REPO_DIR` to `/usr/local/agent-studio`
- refresh derived app paths from resolved `REPO_DIR`
- record the repo-resolution source in state

- [ ] **Step 4: Make usable local repo satisfy repo_clone without clone**

Update `attempt_clone()` logic so that:
- a usable checkout at the resolved repo dir marks `repo_clone` complete immediately
- a skipped clone only blocks downstream phases when no usable repo exists
- selecting “no” at the clone prompt does not poison a valid existing checkout state

- [ ] **Step 5: Run the verifier and shell syntax checks**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash -n scripts/install-ubuntu.sh scripts/lib/common.sh
bash temp/verify-install-script.sh
```

Expected:
- PASS for the new repo-resolution assertions

- [ ] **Step 6: Commit**

```bash
git add scripts/install-ubuntu.sh scripts/lib/common.sh temp/verify-install-script.sh
git commit -m "feat: add installer bootstrap defaults"
```

### Task 2: Add Ubuntu Dependency Installation Phase

**Files:**
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/lib/common.sh`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-install-script.sh`

- [ ] **Step 1: Extend the verifier to require dependency bootstrap markers**

```bash
# Add static checks for:
# - apt install flow
# - Node.js 22 bootstrap flow
# - PM2 install flow
# - recorded dependency status keys
```

- [ ] **Step 2: Run the verifier to confirm failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-install-script.sh
```

Expected:
- FAIL because dependency bootstrap is not yet implemented

- [ ] **Step 3: Add package installation helpers in common.sh**

Add reusable helpers for:
- checking package presence
- running `apt-get update` once per installer run
- installing a package set idempotently
- checking Node major version
- installing NodeSource Node.js 22 only when needed
- installing PM2 globally when missing

- [ ] **Step 4: Add a new dependency bootstrap phase in install-ubuntu.sh**

Add phase behavior:
- install `git curl ca-certificates build-essential python3 openssl unzip postgresql postgresql-contrib caddy`
- install or upgrade Node.js to major version 22
- install PM2 if missing
- record per-subsystem state like:
  - `system_packages_status`
  - `nodejs_status`
  - `pm2_install_status`
- if installation fails, leave pending with explicit reason

- [ ] **Step 5: Place dependency bootstrap before PostgreSQL/env/deploy phases**

Ensure installer order becomes:
- root check
- app user
- base directories
- repo resolution / clone
- dependency bootstrap
- PostgreSQL bootstrap
- env files
- Caddy config
- first deploy
- PM2 start
- Codex validation

- [ ] **Step 6: Run verifier and syntax checks**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash -n scripts/install-ubuntu.sh scripts/lib/common.sh
bash temp/verify-install-script.sh
```

Expected:
- PASS for dependency bootstrap assertions

- [ ] **Step 7: Commit**

```bash
git add scripts/install-ubuntu.sh scripts/lib/common.sh temp/verify-install-script.sh
git commit -m "feat: add installer dependency bootstrap"
```

### Task 3: Upgrade PostgreSQL Phase to Full Bootstrap

**Files:**
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/lib/common.sh`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/agent-api.env.template`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-install-script.sh`

- [ ] **Step 1: Extend verifier expectations for PostgreSQL bootstrap**

Add checks for:
- generated password path
- role/database bootstrap markers
- service readiness markers
- env population support for generated credentials

- [ ] **Step 2: Run verifier to confirm failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-install-script.sh
```

Expected:
- FAIL because PostgreSQL still only probes instead of bootstrapping

- [ ] **Step 3: Add PostgreSQL bootstrap helpers**

In `common.sh`, add helpers for:
- generating a strong random password
- starting/enabling PostgreSQL service if needed
- executing safe psql admin commands
- redacting secrets in logs/state summaries

- [ ] **Step 4: Replace probe-only postgres phase with bootstrap behavior**

In `install-ubuntu.sh`:
- ensure PostgreSQL service is available and running
- create role `agentstudio` if missing
- create database `agent_studio` if missing
- optionally prompt once for a manual password override only if operator asks
- otherwise generate a random password automatically
- record sub-status for service/role/database
- write the generated credentials into backend env rendering inputs

- [ ] **Step 5: Ensure env generation consumes the actual DB credentials**

Update env rendering so backend `.env` gets the real generated or supplied `DATABASE_URL`, not a template placeholder that still needs manual editing.

- [ ] **Step 6: Run verifier and shell checks**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash -n scripts/install-ubuntu.sh scripts/lib/common.sh
bash temp/verify-install-script.sh
```

Expected:
- PASS for PostgreSQL bootstrap assertions

- [ ] **Step 7: Commit**

```bash
git add scripts/install-ubuntu.sh scripts/lib/common.sh templates/agent-api.env.template temp/verify-install-script.sh
git commit -m "feat: bootstrap postgres during install"
```

### Task 4: Tighten Zero-Argument Prompting and Clone Semantics

**Files:**
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-install-script.sh`

- [ ] **Step 1: Adjust prompts to prefer automatic continuation**

Update installer prompts so that zero-argument installs:
- avoid asking about clone when a usable current-directory repo already exists
- avoid asking about deploy keys unless clone is actually needed
- continue with automatic defaults for dependency install and PostgreSQL bootstrap
- keep only essential prompts such as domain and optional private-repo bootstrap decisions

- [ ] **Step 2: Ensure declining clone behaves correctly**

Implement and verify:
- if repo exists locally, saying “no” to clone still allows downstream env/deploy phases
- if repo does not exist, declining clone leaves only repo-dependent phases pending
- `--no-clone` remains as an advanced override but is not needed in the normal installer path

- [ ] **Step 3: Run verifier**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-install-script.sh
```

Expected:
- PASS for zero-argument and non-blocking clone semantics

- [ ] **Step 4: Commit**

```bash
git add scripts/install-ubuntu.sh temp/verify-install-script.sh
git commit -m "fix: streamline zero-argument installer flow"
```

### Task 5: Update Docs and Environment Checks for New Installer Behavior

**Files:**
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/ubuntu-caddy-pm2.md`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/troubleshooting.md`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/check-env.sh`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-doctor-and-docs.sh`

- [ ] **Step 1: Update deployment docs to reflect root-run zero-argument install**

Document:
- `sudo bash scripts/install-ubuntu.sh`
- current-directory repo detection
- fallback clone to `/usr/local/agent-studio`
- automatic dependency installation
- automatic PostgreSQL bootstrap
- manual Codex authentication follow-up

- [ ] **Step 2: Align troubleshooting with new installer responsibilities**

Update troubleshooting content to cover:
- apt/package failures
- PostgreSQL bootstrap failures
- repo-resolution mismatches
- Codex auth pending after otherwise successful install

- [ ] **Step 3: Align check-env assumptions if needed**

Update `check-env.sh` only where necessary so that messages and checks match the stronger installer behavior without weakening validation.

- [ ] **Step 4: Run verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash -n scripts/check-env.sh
bash temp/verify-doctor-and-docs.sh
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add docs/deployment/ubuntu-caddy-pm2.md docs/deployment/troubleshooting.md scripts/check-env.sh temp/verify-doctor-and-docs.sh
git commit -m "docs: align installer bootstrap guidance"
```

### Task 6: Final End-to-End Verification

**Files:**
- Verify only: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh`
- Verify only: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/deploy-agent-studio.sh`
- Verify only: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/check-env.sh`
- Verify only: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/doctor.sh`
- Verify only: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-deployment-templates.sh`
- Verify only: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-install-script.sh`
- Verify only: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-deploy-script.sh`
- Verify only: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-check-env.sh`
- Verify only: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-doctor-and-docs.sh`

- [ ] **Step 1: Run full verification suite**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash -n scripts/install-ubuntu.sh scripts/deploy-agent-studio.sh scripts/check-env.sh scripts/doctor.sh
bash temp/verify-deployment-templates.sh
bash temp/verify-install-script.sh
bash temp/verify-deploy-script.sh
bash temp/verify-check-env.sh
bash temp/verify-doctor-and-docs.sh
```

Expected:
- all commands exit `0`

- [ ] **Step 2: Review resulting git diff for unintended changes**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
git diff --stat
```

Expected:
- only installer/bootstrap-related files changed

- [ ] **Step 3: Commit any final verification-driven fixes**

```bash
git add scripts scripts/lib docs/deployment templates temp
git commit -m "fix: finalize installer bootstrap flow"
```
