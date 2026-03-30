# Agent Studio Capability Center Design

## Context

The platform foundation, workspace / knowledge-set resource management, organization sync, RBAC, and monitoring / quota layers are now implemented. The backend models for:

- `agent_mode`
- `skill_package`
- `run_profile`

already exist and are consumed by the portal runtime option service. What is still missing is the admin operating surface that lets administrators manage these capability resources directly rather than only through backend APIs.

This sub-project adds a unified admin capability center so administrators can operate agent-facing capability definitions with the same level of control already available in the resource center.

## Goals

1. Add a unified admin capability center for:
   - `agent_mode`
   - `skill_package`
   - `run_profile`
2. Support resource lifecycle operations:
   - create
   - edit
   - copy
   - enable / disable
3. Let admins manage bindings directly in the capability center:
   - `agent_mode -> run_profile`
   - `agent_mode -> skill_package[]`
   - `agent_mode -> workspace / additional directory policy`
   - `agent_mode -> instruction_source[]`
   - `skill_package -> item[]`
   - `skill_package -> runtime_binding[]`
4. Let admins edit authorization at role / department / user scope for each capability resource.
5. Keep the capability center behavior aligned with the already-shipped resource center patterns so the admin experience is coherent.
6. Preserve runtime semantics where edits affect new requests and new sessions only, while already-running sessions keep their existing snapshot.

## Non-Goals

This phase does not include:

- physical deletion of `agent_mode`, `skill_package`, or `run_profile`
- skill version registry / publishing workflow
- approval workflows for config changes
- multi-runtime execution engine support beyond the existing runtime-neutral binding model
- new employee-facing portal behavior beyond consuming the already-supported persisted models
- audit / monitoring redesign beyond using the existing audit foundations

## Product Behavior

### Admin behavior

Admins can enter a new `能力配置中心` section in the admin shell.

Inside it they can switch between:

- `Agent Modes`
- `Skill Packages`
- `Run Profiles`

For each resource type they can:

- browse a searchable list
- filter by status and visibility
- select an existing record to inspect and edit
- create a new record
- copy an existing record into a new one
- enable or disable a record

The right-side detail area is organized as tabs:

- `基本信息`
- `绑定关系`
- `授权`

### Agent mode behavior

`agent_mode` detail supports:

- basic fields:
  - name
  - slug
  - description
  - status
  - `visible_to_users`
- binding exactly one `run_profile`
- binding many `skill_package` records
- configuring workspace selection scope
- configuring whether additional directories are allowed
- configuring the allowed directory-source scope for additional directories
- configuring instruction sources

Instruction source types supported in this phase:

- inline text
- workspace `AGENTS.md`
- controlled knowledge-set document references

### Skill package behavior

`skill_package` detail supports:

- basic fields:
  - name
  - slug
  - description
  - status
  - `visible_to_users`
- structured item table editing
- runtime binding editing

Skill package items are managed as structured rows rather than a free-text blob.

Each item row includes at least:

- `capability_key`
- description
- runtime
- binding

### Run profile behavior

`run_profile` detail supports:

- basic fields:
  - name
  - slug
  - description
  - status
  - `visible_to_users`
- default model
- allowed model set
- reasoning effort
- sandbox mode
- approval policy
- network access flag
- web search mode
- directory selection policy preview
- `AGENTS.md` load policy preview
- instruction source preview

This center treats run profiles as editable policy templates and shows the runtime envelope that downstream agent modes consume.

### Authorization behavior

Each capability resource supports per-resource authorization editing using the existing resource-policy model.

Admins can maintain:

- role rules
- department rules
- user rules
- `allow` and `deny`

The capability center does not introduce a second authorization model. It reuses `resource_policies` exactly as the resource center already does.

### Runtime effect behavior

Any change made in the capability center:

- affects new requests immediately
- affects newly created sessions immediately
- does not retroactively mutate already-running sessions

The runtime snapshot behavior remains unchanged.

## UX Structure

### Navigation structure

The capability center should mirror the interaction pattern of the resource center.

Layout:

- left rail:
  - resource-type switcher
  - search input
  - status filter
  - visibility filter
  - filtered record list
  - create action
- right pane:
  - selected resource detail
  - create panel when creating new records
  - empty-state placeholder when nothing is selected

### Detail tabs

Every selected record shows these tabs:

- `基本信息`
- `绑定关系`
- `授权`

The details inside each tab differ by resource type, but the tab structure remains consistent.

### Copy behavior

Admins can copy any existing:

- `agent_mode`
- `skill_package`
- `run_profile`

Copy creates a new draft-like record with:

- a new id
- a new slug required before save or generated as a suffixed slug
- copied bindings where valid for that resource type
- copied visibility / status fields, except implementations may default copied records to disabled if that reduces accidental rollout risk

This phase should choose one deterministic copy policy and keep it consistent across all three resource types.

## Backend Design

### Reuse existing APIs where possible

The backend persistence and admin-router surface for modes / skill packages / run profiles already exists. This sub-project should extend it where necessary, not replace it.

Expected backend surface after this phase:

- list, create, patch for `run_profile`
- list, create, patch for `skill_package`
- replace item rows for `skill_package`
- replace runtime bindings for `skill_package`
- list, create, patch for `agent_mode`
- replace skill-package bindings for `agent_mode`
- replace workspace-scope / directory-policy bindings for `agent_mode`
- replace instruction sources for `agent_mode`
- per-resource authorization get/put for:
  - `run_profile`
  - `skill_package`
  - `agent_mode`
- copy endpoints or equivalent create-from-existing flows for all three resource types

### Authorization resource types

The existing `resource_policies` resource types already include:

- `agent_mode`
- `skill_package`
- `run_profile`

The capability center should reuse those resource types directly.

### Validation rules

The backend must enforce:

- one bound `run_profile` per `agent_mode`
- only existing `skill_package` ids can bind to an `agent_mode`
- only authorized / existing workspace references can be stored in mode workspace scope config
- instruction source references must be structurally valid for:
  - inline text
  - workspace `AGENTS.md`
  - knowledge-set document ref
- disabled or invisible resources remain persisted but are excluded from employee-facing portal results according to existing runtime option logic

## Frontend Design

### New feature area

Create a frontend feature group under a path similar to:

- `agent-ui/src/features/capability-center/`

It should follow the same organization style as:

- `resources-center`
- `monitoring`
- `rbac`

### Main components

Expected component set:

- `CapabilityCenterShell`
- `RunProfileDetailView`
- `SkillPackageDetailView`
- `SkillPackageItemEditor`
- `AgentModeDetailView`
- `InstructionSourceEditor`
- `CapabilityPolicyEditor` or reuse a generalized policy editor if the existing one can be shared safely

### Shared interaction rules

- all timestamps displayed in the admin UI must use the admin user's local timezone
- save actions must disable conflicting controls while in flight
- create / copy flows must surface inline validation and API errors
- tab switches must not leak stale async responses between selected resources
- changing filters must not accidentally mutate the selected resource detail unless the selected record is filtered out and an explicit reset rule says so

## Data Translation Rules

### Run profile

The UI edits backend-facing fields that eventually feed runtime option snapshots. The capability center should display these as policy fields, not as raw runtime internals.

### Agent mode directory policy

The UI should not expose arbitrary server path entry for employee-facing directory choice. Instead it should manage policy fields that define:

- selectable workspaces
- whether additional directories are allowed
- what sources those directories may come from

This remains a policy-definition UI, not an arbitrary filesystem editor.

### Instruction source editing

Instruction sources must be represented explicitly in the UI, not as an opaque JSON blob.

The admin should be able to see and edit ordered instruction layers so downstream runtime merging remains understandable.

## Testing Strategy

### Backend

Add or extend tests for:

- mode admin router create / patch / binding replacement
- copy flows for all capability resources
- authorization get / put for capability resource types
- validation failures for invalid bindings or invalid instruction-source payloads

### Frontend

Add or extend tests for:

- capability center shell navigation
- create / copy flows
- list filtering and selection behavior
- run profile detail editing
- skill package item editing and runtime binding editing
- agent mode binding editing
- authorization editing for each capability resource type
- stale async response protection on resource switching

### Verification

Before calling the sub-project complete, run:

- targeted backend tests for the mode admin router and related repositories
- targeted frontend tests for the capability center
- full backend test + build
- full frontend test + build

## Risks And Constraints

1. The existing backend shape for mode / skill / profile management may not expose every binding needed by the capability center yet. In that case, extend the current admin router surface rather than creating a parallel capability backend.
2. The instruction-source model must stay explicit enough for admins to operate, but not turn into an unrestricted file-reference editor.
3. Copy behavior can accidentally create visible or active records too early if not constrained; the implementation should choose a conservative default.
4. This phase should not regress the already-working portal runtime option resolution.

## Acceptance Criteria

This sub-project is complete when:

1. The admin shell exposes a unified `能力配置中心`.
2. Admins can create, edit, copy, enable, and disable:
   - `agent_mode`
   - `skill_package`
   - `run_profile`
3. Admins can edit:
   - mode bindings
   - skill package items and runtime bindings
   - run profile runtime policy fields
4. Admins can edit role / department / user authorization for all three capability resource types.
5. Portal runtime behavior continues to consume persisted capability definitions without reintroducing hardcoded mode logic.
6. Full targeted and full-project verification passes.
