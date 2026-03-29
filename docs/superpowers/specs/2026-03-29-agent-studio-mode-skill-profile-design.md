# Agent Studio Mode, Skill Package, And Run Profile Design

## Context

The cloud foundation and workspace / knowledge-set sub-projects are complete:

- persistent session, thread, and resource storage exists
- DingTalk-backed identity and department-aware resource authorization exist
- admin and portal shells exist
- workspaces and knowledge sets can be authorized and mounted into runtime sessions

The next sub-project removes the remaining hardcoded portal mode/runtime behavior and replaces it with first-class managed models for:

- agent modes
- skill packages
- run profiles
- runtime bindings
- instruction sources

This sub-project does not implement full admin pages, skill version registries, audit dashboards, external tenant support, or a second runtime execution engine. It does, however, make the model runtime-neutral so future Codex / Claude Code style runtimes can share the same platform objects.

## Goals

1. Replace hardcoded or role-derived portal mode options with persisted `agent_mode` records.
2. Add first-class `skill_package` records that logically group platform-neutral capabilities rather than directly storing a single-agent skill identifier.
3. Add first-class `run_profile` records that define the runtime policy envelope consumed by the employee portal.
4. Support authorization for `agent_mode`, `skill_package`, and `run_profile` at:
   - role
   - department
   - user
5. Let an `agent_mode` bind:
   - one `run_profile`
   - many allowed `skill_packages`
   - controlled workspace and directory-selection rules
   - mode-level instruction sources
6. Let the employee portal consume authorized mode/runtime configuration from backend APIs instead of local hardcoded derivation.
7. Let an agent mode support controlled user choice of accessible directories and workspace `AGENTS.md` loading without exposing arbitrary server paths.
8. Preserve the existing runtime contract by translating these models into the current `workspace`, `model`, `reasoning_effort`, and `codex_run_config` shape.

## Non-Goals

This phase explicitly does not include:

- skill package versioning or release management
- full Codex / Claude dual-runtime execution support in this phase
- full admin CRUD pages in the frontend
- vector retrieval
- audit and quota dashboards
- approval workflow builder
- external customer / multi-tenant product behavior

## Product Behavior

### Admin behavior

Admins can:

- create and edit agent modes
- create and edit skill packages
- create and edit run profiles
- bind skill packages to agent modes
- bind a single run profile to an agent mode
- configure mode-level workspace selection behavior
- configure whether workspace `AGENTS.md` is loaded
- configure mode-level instruction sources
- define authorization rules for agent modes, skill packages, and run profiles at role, department, and user level

This phase exposes management through backend APIs. Admin frontend pages are deferred.

### Employee behavior

When an employee opens the portal:

- they see only authorized agent modes
- each visible mode has a label and description suitable for the employee portal
- selecting a mode applies the bound run profile as the source of runtime defaults and restrictions
- the selected mode constrains which workspaces and controlled directories may be chosen
- the employee may choose additional accessible directories only when the mode explicitly allows it and only inside the allowed scope
- workspace `AGENTS.md` can be auto-loaded when the mode enables it
- the employee does not see the underlying skill package mapping
- the employee does not directly edit sandbox mode, approval policy, or low-level network/search controls

### Runtime behavior

When the portal creates or refreshes a session:

- the selected `agent_mode` determines the runtime strategy
- the bound `run_profile` defines the effective runtime defaults:
  - model
  - reasoning effort
  - sandbox mode
  - approval policy
  - network access
  - web search mode
- the mode’s allowed skill packages are resolved into runtime-specific capability bindings
- workspace-level and mode-level instruction sources are merged into runtime input in a deterministic order
- only authorized modes and their authorized bound resources can be used
- user-selected additional directories are validated server-side against the mode’s allowed directory-selection policy
- the runtime still receives the existing compatible shape for the current Codex execution engine:
  - `workspace`
  - `model`
  - `reasoning_effort`
  - `codex_run_config`
- the persisted platform model remains runtime-neutral so future Claude Code style runtimes can consume the same mode / skill package / run profile definitions via a different adapter

## Core Design

### Model separation

The three model types remain explicitly decoupled:

- `agent_mode`
  - the employee-facing scene entry
- `skill_package`
  - the logical ability grouping that maps to platform capabilities
- `run_profile`
  - the low-level runtime strategy template

A mode is not a profile. A profile is not a skill bundle. A skill package is not a Codex-only skill list. Binding happens through explicit relationships.

### Runtime-neutral binding approach

The platform model should not assume a single agent runtime.

This phase introduces runtime-neutral skill packaging plus explicit runtime bindings:

- platform objects describe intent
- runtime bindings describe how that intent maps to a concrete runtime

Examples:

- a package capability may map to a Codex config fragment today
- the same package capability may map to a Claude Code prompt/tool convention later

The current executable runtime remains Codex, but the data model should not force future runtimes to reinterpret Codex-specific identifiers as the source of truth.

### Instruction source approach

Instruction content comes from layered sources:

1. platform/system instructions
2. `agent_mode` instruction sources
3. workspace `AGENTS.md` when enabled by the selected mode
4. user input

This lets a mode combine scene-specific guardrails with project-local instructions without exposing arbitrary file-path selection to employees.

### Portal integration approach

The current `/api/portal/runtime-options` endpoint remains the portal entry point, but its implementation changes from hardcoded derivation to persisted policy resolution.

The endpoint will return:

- authorized `modes`
- authorized `workspaces`
- `can_upload`
- defaults derived from the authorized default mode and workspace
- the runtime snapshot fields needed by the existing portal shell
- mode-level directory selection flags needed by the existing portal shell

This keeps the portal API surface stable while replacing the source of truth.

### Runtime compatibility strategy

The current frontend and backend already operate on:

- `model`
- `reasoning_effort`
- `workspace`
- `codex_run_config`

This sub-project does not redesign the runtime protocol. Instead, it introduces a translation layer from:

`agent_mode -> run_profile + skill_package bindings + instruction sources + directory policy -> runtime option snapshot`

That allows the portal to stop exposing raw policy editing while the current Codex runtime continues to receive the same contract. Future runtimes should plug in at this translation layer rather than reading platform tables directly as Codex-specific config.

## Data Model

### Agent mode

`agent_modes`

- `id`
- `organization_id`
- `name`
- `slug`
- `description`
- `status` (`active | disabled`)
- `visible_to_users` (`true | false`)
- `run_profile_id`
- `created_at`
- `updated_at`

Rules:

- each mode binds exactly one run profile
- disabled modes are not visible in the portal
- invisible modes may exist for future internal or staged usage but are not returned to employees

### Skill package

`skill_packages`

- `id`
- `organization_id`
- `name`
- `slug`
- `description`
- `status` (`active | disabled`)
- `visible_to_users` (`true | false`)
- `created_at`
- `updated_at`

`skill_package_items`

- `id`
- `skill_package_id`
- `capability_key`
- `description`
- `created_at`
- `updated_at`

`skill_package_runtime_bindings`

- `id`
- `skill_package_item_id`
- `runtime_type` (`codex | claude_code`)
- `binding_type`
- `binding_payload` (JSON)
- `created_at`
- `updated_at`

Rules:

- `skill_identifier` is replaced by a platform-neutral capability identifier in this phase
- this phase treats skill packages as logical groupings, not versioned registries

### Run profile

`run_profiles`

- `id`
- `organization_id`
- `name`
- `slug`
- `description`
- `status` (`active | disabled`)
- `default_model`
- `allowed_models` (JSON string array)
- `default_reasoning_effort`
- `sandbox_mode`
- `approval_policy`
- `network_access_enabled`
- `web_search_mode`
- `created_at`
- `updated_at`

First-phase runtime fields are intentionally limited to parameters already present in the current employee portal and backend runtime contract.

### Agent mode workspace rules

`agent_mode_workspaces`

- `id`
- `agent_mode_id`
- `workspace_id`
- `is_default`
- `allow_directory_selection`
- `directory_scope` (`workspace_root_only | descendants_only`)
- `load_workspace_agents_md`
- `created_at`
- `updated_at`

Rules:

- a mode may bind many workspaces
- one workspace may be marked as the mode default
- `allow_directory_selection` controls whether the employee may add controlled additional directories inside the selected workspace
- `load_workspace_agents_md` controls whether the selected workspace root `AGENTS.md` participates in instruction resolution

### Agent mode instruction sources

`agent_mode_instruction_sources`

- `id`
- `agent_mode_id`
- `source_type` (`inline_text | knowledge_set_document`)
- `source_ref`
- `sort_order`
- `created_at`
- `updated_at`

Rules:

- `inline_text` stores mode-level maintained instruction content
- `knowledge_set_document` references a controlled document source rather than an arbitrary file path
- this phase supports persisted references and ordered resolution, not a rich document editor

### Mode to skill-package bindings

`agent_mode_skill_packages`

- `id`
- `agent_mode_id`
- `skill_package_id`
- `created_at`
- `updated_at`

Rules:

- a mode may bind many skill packages
- a skill package may be reused by many modes

### Authorization model

Reuse `resource_policies` rather than creating a separate policy system.

Extended `resource_type` values:

- `agent_mode`
- `skill_package`
- `run_profile`

Existing fields remain unchanged:

- `subject_type` (`role | department | user`)
- `subject_id`
- `resource_type`
- `resource_id`
- `effect` (`allow | deny`)

This keeps authorization evaluation consistent with the workspace / knowledge-set project.

## API Design

### Admin APIs

Add backend APIs for model management.

#### Agent modes

- `GET /api/admin/agent-modes`
- `POST /api/admin/agent-modes`
- `PATCH /api/admin/agent-modes/:agentModeId`
- `GET /api/admin/agent-modes/:agentModeId/skill-packages`
- `PUT /api/admin/agent-modes/:agentModeId/skill-packages`
- `GET /api/admin/agent-modes/:agentModeId/workspaces`
- `PUT /api/admin/agent-modes/:agentModeId/workspaces`
- `GET /api/admin/agent-modes/:agentModeId/instruction-sources`
- `PUT /api/admin/agent-modes/:agentModeId/instruction-sources`

#### Skill packages

- `GET /api/admin/skill-packages`
- `POST /api/admin/skill-packages`
- `PATCH /api/admin/skill-packages/:skillPackageId`
- `GET /api/admin/skill-packages/:skillPackageId/items`
- `PUT /api/admin/skill-packages/:skillPackageId/items`
- `GET /api/admin/skill-packages/:skillPackageId/runtime-bindings`
- `PUT /api/admin/skill-packages/:skillPackageId/runtime-bindings`

#### Run profiles

- `GET /api/admin/run-profiles`
- `POST /api/admin/run-profiles`
- `PATCH /api/admin/run-profiles/:runProfileId`

#### Authorization

Reuse the existing resource-policy admin APIs with the newly supported resource types.

### Portal APIs

#### Runtime options

Continue using:

- `GET /api/portal/runtime-options`

But the response will now come from persisted authorization and bindings instead of hardcoded role checks.

Response shape stays compatible at the top level, but each mode now also carries the policy snapshot the current portal shell needs.

- `modes`
  - `id`
  - `label`
  - `description`
  - `runtime_profile`
  - `allow_directory_selection`
- `workspaces`
  - existing shape retained
- `canUpload`
- `defaults`
  - `mode`
  - `workspace`

Implementation changes:

- portal mode list comes from authorized visible `agent_modes`
- defaults come from the first authorized active mode and authorized workspace if no stronger default rule exists
- runtime fields that were previously implied locally are derived from the selected mode’s bound run profile
- workspaces returned to the portal are filtered both by workspace authorization and by the selected mode’s workspace bindings
- directory selection is enabled only when the selected mode allows it

This phase does not add a new portal endpoint for mode metadata because the existing runtime-options response can carry the needed mode snapshot for the current portal shell.

## Backend Translation Layer

### Portal runtime option service

Add a dedicated backend service that resolves portal runtime options from persisted models.

Inputs:

- current user id
- current user role
- current user department ids

Outputs:

- authorized visible modes
- authorized workspaces filtered through mode bindings
- default selections
- mode-derived runtime policy snapshot map
- mode-level directory selection and instruction-source settings

### Session resolution

When the frontend creates or refreshes a session using a selected mode:

- backend validates the mode is authorized
- backend validates the bound run profile is authorized and active
- backend resolves allowed skill packages for that mode through runtime-specific bindings
- backend validates selected workspace and any user-selected directories against the mode’s workspace rules
- backend resolves instruction sources, including workspace `AGENTS.md` when enabled
- backend applies the run-profile settings to the runtime option resolution
- backend persists the resolved runtime configuration snapshot on the thread/session

This continues the existing principle that runtime behavior is decided server-side, not by trusting frontend-provided low-level settings.

## Frontend Changes

### Portal shell behavior

The portal shell stops treating `mode` as a mostly local label.

Instead:

- mode options are entirely backend-provided
- selecting a mode updates the effective runtime policy snapshot used for session creation
- if the mode allows directory selection, the employee can choose additional directories only inside the authorized workspace scope
- low-level controls for sandbox, approval, network, and search remain hidden from employees
- model and reasoning depth display continue to reflect the effective resolved runtime policy

### Existing low-level UI cleanup

The current portal shell still contains internal state for fields such as sandbox mode, approval policy, and web search mode. In this phase those values should either:

- be sourced from the selected run profile snapshot, or
- remain internal compatibility state with no employee edit affordance

The direction is toward policy-driven display, not user editing.

## Authorization Rules

### General rules

- deny overrides allow
- disabled resources are never returned even if a policy allows them
- an `agent_mode` is usable only if:
  - the mode itself is authorized and active
  - its bound run profile is authorized and active
  - its bound skill packages are authorized and active
  - its bound workspaces remain authorized and active

### Portal visibility rules

Employees only see:

- visible active modes
- that survive policy evaluation across role, department, and user scopes
- whose dependent resources also remain valid

If a mode loses its profile or all bound skill packages, it is considered invalid and should not be returned.

## Testing Strategy

### Backend

Add tests for:

- run profile repository CRUD
- skill package repository CRUD
- runtime binding repository CRUD
- agent mode repository CRUD
- mode to skill-package binding replacement
- mode to workspace rule replacement
- policy evaluation for `agent_mode`, `skill_package`, and `run_profile`
- portal runtime option resolution from persisted models
- invalid dependent-resource filtering
- workspace `AGENTS.md` enablement flags in mode snapshots
- admin CRUD API validation for the three model types and their bindings

### Frontend

Add tests for:

- portal mode options rendering from API data
- selected mode changes update displayed runtime labels
- mode-level directory selection affordance only appears when allowed
- low-level employee editing remains unavailable
- session create / session ensure continue to use mode-derived runtime values rather than local hardcoded fallbacks

## Delivery Strategy

Recommended implementation order:

1. Prisma models and migration for run profiles, skill packages, runtime bindings, instruction sources, and agent modes
2. repositories and binding repositories
3. admin CRUD APIs
4. portal runtime option resolver service
5. portal runtime-options endpoint migration from hardcoded derivation
6. portal shell integration and tests
7. regression verification across session creation and update paths

## Open Follow-On Work

This design intentionally leaves room for later sub-projects:

- admin frontend pages for the three model types
- actual Claude Code execution adapter
- skill registry versioning and staged release
- richer mode to workspace / knowledge-set default binding rules beyond the current runtime options scope
- audit and quota reporting for mode usage
- approval workflow composition

## Decision Summary

Confirmed decisions for this sub-project:

- implementation scope is backend model + APIs + portal consumption, not admin pages
- `agent_mode` binds `run_profile`, allowed `skill_package`, workspace rules, and instruction sources
- `skill_package` is a logical grouping of platform capabilities, not a Codex-only skill list
- runtime-specific behavior is carried by explicit bindings so future Codex / Claude Code adapters can share the same platform model
- `run_profile` controls current core runtime parameters plus model whitelist/defaults
- authorization is supported at role, department, and user levels
- portal runtime-options should move from hardcoded derivation to persisted policy resolution
- agent modes may allow controlled directory selection and workspace `AGENTS.md` loading without exposing arbitrary filesystem paths
