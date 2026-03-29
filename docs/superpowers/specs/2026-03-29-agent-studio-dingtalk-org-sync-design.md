# Agent Studio DingTalk Organization Sync And Admin Design

## Context

The cloud foundation, workspace / knowledge-set, and mode / skill / profile sub-projects are complete:

- DingTalk-backed login exists
- persistent user, thread, session, resource, and mode storage exists
- department membership is already used by resource authorization
- the admin shell exists, but it currently exposes only a top-level overview
- there is no first-class organization-sync workflow, no persisted department tree, and no user / department admin management surface

The next sub-project closes that gap by adding:

- DingTalk organization sync
- persisted department hierarchy
- user-to-department sync and primary department tracking
- sync jobs, snapshots, and diff history
- admin management for users and departments

This phase does not implement a full role / permission editor. It does, however, support assigning existing platform roles to users from the admin UI.

## Goals

1. Add first-class organization sync from DingTalk into persisted department and user metadata.
2. Support three sync entry points:
   - full organization sync
   - department-scoped sync
   - single-user patch sync
3. Persist the department tree, user memberships, and primary-department markers.
4. Track sync jobs, job events, raw snapshots, and normalized diffs for audit and troubleshooting.
5. Support scheduled automatic sync with configurable cadence and a default of once per day.
6. Let administrators manage users and departments from the admin console with:
   - user list
   - user detail
   - department tree
   - manual sync entry points
   - user status changes
   - role assignment using existing roles
   - admin notes
7. Synchronize DingTalk account status so disabled or departed employees are disabled locally, while preserving explicit admin manual disable decisions.
8. Keep DingTalk-sourced profile fields read-only in the admin UI and restrict edits to local platform fields.

## Non-Goals

This phase explicitly does not include:

- a full role / permission editor
- manager or supervisor relationship sync
- external customer tenant support
- SCIM or other non-DingTalk identity providers
- approval workflows for user lifecycle changes
- HR master-data reconciliation beyond DingTalk
- employee-facing organization browsing features

## Product Behavior

### Admin behavior

Admins can:

- trigger a full organization sync
- trigger a sync for a single department
- trigger a sync for a single DingTalk user
- view recent sync jobs and their status
- inspect per-job events and diff summaries
- browse the department tree
- view department members
- browse users with filters for role, status, sync source, and department
- open a user detail page
- edit only local platform fields on a user:
  - role
  - local status override
  - admin note

Admins cannot directly edit DingTalk-owned fields such as:

- DingTalk identifiers
- synced display name
- synced email / contact data
- synced department membership

### Sync behavior

The system supports two sync modes:

- manual sync, triggered by an admin
- scheduled sync, triggered automatically on a configurable cadence

The default scheduled cadence is once per day.

Supported sync scopes:

- full tenant sync
- one department and its current members
- one user patch sync

Each sync run records:

- the requested scope
- who triggered it, if manual
- job lifecycle events
- raw or normalized remote snapshots used by the job
- normalized diffs showing created, updated, disabled, restored, and membership-changed records

### User status behavior

User status comes from two sources:

- DingTalk lifecycle state
- local admin override state

Conflict resolution rules:

1. If an admin manually disables a user, later DingTalk sync must not re-enable that user.
2. If DingTalk marks a user disabled or departed, the platform disables that user unless they are already manually disabled.
3. If DingTalk returns a user as active again, the platform may restore the user only when there is no manual disable override.
4. Role and admin note remain local platform fields and are never overwritten by DingTalk sync.

### Employee behavior

Employees do not interact with the sync system directly.

They are affected indirectly by:

- successful login only if their local account remains active
- department-aware resource and mode authorization using synced memberships

## Core Design

### Identity ownership model

Identity ownership is split between DingTalk and the local platform.

DingTalk remains the source of truth for:

- employee identity keys
- display name and synced contact fields
- organizational membership
- lifecycle state such as enabled / disabled / departed

The local platform remains the source of truth for:

- role assignment
- manual disable override
- admin note
- audit metadata about sync behavior

This keeps the platform aligned to the enterprise identity source without losing local governance.

### Organization sync model

The sync engine is pull-based.

For each run, the service:

1. resolves the requested scope
2. fetches current DingTalk organization data for that scope
3. normalizes remote records into platform sync shapes
4. compares normalized remote data with current persisted local state
5. writes user, department, and membership changes
6. records snapshots, job events, and diffs
7. marks the job succeeded or failed

The design keeps sync computation separate from admin HTTP routes so scheduled jobs and manual routes share the same execution path.

### Department model

Departments become first-class persisted records rather than implied identifiers.

A department record stores:

- DingTalk department identifier
- parent department link
- department name
- ordering metadata when available
- active / disabled sync status
- sync timestamps

Memberships remain a separate table so users may belong to multiple departments while still having a single primary department marker.

### Local status override model

A user record stores both effective status and the source of the latest status decision.

This phase distinguishes:

- synced active
- synced disabled
- synced departed
- manually disabled

The implementation should persist enough state to answer both questions:

- what is the user’s effective current status?
- why is the user in that state?

That means the sync service must not only write `status`, but also explicit metadata such as:

- whether a manual disable override is active
- what source last set the effective status
- when the user was last synced

### Sync observability model

Every sync run must leave a durable trail.

The minimum durable objects are:

- sync job
- sync job event
- sync snapshot
- sync diff record

These records serve different purposes:

- jobs show lifecycle and triggering context
- events show progress and failures
- snapshots preserve the source material used for reconciliation
- diffs make review practical without reading full snapshots

The design intentionally keeps snapshots and diffs separate so the admin UI can show concise changes while engineering still has access to source evidence.

## Data Model

### User extensions

Extend `users` with local governance and sync metadata:

- `status_source` (`sync | manual_disable`)
- `manual_disabled` (`true | false`)
- `admin_note`
- `last_synced_at`
- `sync_state` (`active | disabled | departed`)

Rules:

- `status` remains the effective account status consumed by the platform
- `sync_state` records the latest DingTalk lifecycle interpretation
- `manual_disabled = true` forces `status = disabled`
- `status_source = manual_disable` means automatic sync must not restore the user

### Department

`departments`

- `id`
- `organization_id`
- `external_id` (DingTalk department id)
- `name`
- `parent_department_id`
- `sort_order`
- `status` (`active | disabled`)
- `last_synced_at`
- `created_at`
- `updated_at`

Rules:

- `external_id` is unique
- `parent_department_id` points to another local `departments.id`
- disabled departments remain queryable for audit and historical references

### Department memberships

Extend `department_memberships` with sync metadata:

- `is_primary`
- `source` (`sync`)
- `last_synced_at`

Rules:

- one user may belong to multiple departments
- at most one membership per user may be marked `is_primary = true`
- sync replaces current synced memberships for the scope being reconciled

### Sync jobs

`sync_jobs`

- `id`
- `organization_id`
- `provider` (`dingtalk`)
- `scope_type` (`full | department | user`)
- `scope_external_id`
- `status` (`pending | running | succeeded | failed | cancelled`)
- `triggered_by_user_id`
- `trigger_type` (`manual | scheduled`)
- `started_at`
- `finished_at`
- `summary`
- `created_at`
- `updated_at`

Purpose:

- durable top-level record for each sync run
- entry point for admin audit and debugging

### Sync job events

`sync_job_events`

- `id`
- `sync_job_id`
- `level` (`info | warning | error`)
- `event_type`
- `message`
- `payload`
- `created_at`

Examples:

- `remote_fetch_started`
- `remote_fetch_completed`
- `diff_computed`
- `user_upserted`
- `department_upserted`
- `sync_failed`

### Sync snapshots

`sync_snapshots`

- `id`
- `sync_job_id`
- `entity_type` (`department | user | membership`)
- `scope_type` (`full | department | user`)
- `scope_external_id`
- `snapshot_payload`
- `created_at`

Purpose:

- preserve normalized remote source data used by the job
- allow post-incident reconstruction without calling DingTalk again

### Sync diffs

`sync_diffs`

- `id`
- `sync_job_id`
- `entity_type` (`department | user | membership`)
- `entity_external_id`
- `change_type` (`created | updated | disabled | restored | removed | primary_changed`)
- `before_payload`
- `after_payload`
- `created_at`

Purpose:

- efficient review of what changed in a run
- compact source for admin UI summaries

## API Design

### Admin sync routes

Add admin routes under `/api/admin/org-sync`:

- `POST /jobs`
  - trigger full sync
- `POST /jobs/department/:externalId`
  - trigger department sync
- `POST /jobs/user/:externalId`
  - trigger single-user sync
- `GET /jobs`
  - list recent jobs
- `GET /jobs/:jobId`
  - job detail with summary
- `GET /jobs/:jobId/events`
  - job event stream or list
- `GET /jobs/:jobId/diffs`
  - diff list for UI inspection

These routes enqueue or start sync through the same service used by the scheduler.

### Admin user routes

Add admin routes under `/api/admin/users`:

- `GET /`
  - list users with filters
- `GET /:userId`
  - user detail
- `PATCH /:userId/local-settings`
  - update role, manual disable flag, admin note

Returned user payload should clearly separate:

- synced profile fields
- local platform fields
- effective status metadata

### Admin department routes

Add admin routes under `/api/admin/departments`:

- `GET /tree`
  - full department tree with basic metrics
- `GET /:departmentId`
  - department detail
- `GET /:departmentId/users`
  - department members

Department routes are read-only in this phase because DingTalk owns the department structure.

### Scheduler control routes

This phase does not require a full scheduler management UI, but the backend should expose enough configuration plumbing for:

- reading current sync cadence
- updating cadence from trusted admin configuration in a later phase

If the existing admin UI needs a simple display of sync cadence, it should read it from backend configuration instead of duplicating frontend constants.

## Admin UI Design

### Admin information architecture

The existing admin shell expands from an overview page into three sections:

- overview
- users
- organization sync

The department tree may live inside the organization section or as a separate navigation item, but it should remain part of the same admin shell rather than a disconnected page.

### Users view

The users view should provide:

- table or list view
- filters for status, role, and department
- synced-vs-local field distinction in detail view
- inline or drawer-based updates for:
  - role
  - manual disable
  - admin note

The UI must not present synced profile fields as editable controls.

### Department view

The department view should provide:

- tree navigation
- member count per node
- department member list
- visibility into primary department markers

The UI is read-only for department structure in this phase.

### Organization sync view

The sync view should provide:

- button to trigger full sync
- entry points for department and user sync
- recent job list
- per-job status and timing
- diff summary and error summary
- current configured automatic sync cadence

## Scheduling Design

The scheduled sync must run through the same application service as manual sync.

Requirements:

- cadence is configurable
- default cadence is once per day
- the scheduler must prevent overlapping runs of the same scope when one is already active
- a failed scheduled run records the same jobs, events, and diffs model as a manual run

A lightweight in-process scheduler is acceptable for this phase if it is clearly isolated behind a scheduling service and can later be replaced by an external scheduler without rewriting sync logic.

## Error Handling

The sync service must handle these failure classes explicitly:

- DingTalk auth or API failure
- partial remote fetch failure
- normalization or validation failure
- persistence failure
- duplicate or overlapping sync attempts

Behavior requirements:

- job status must always resolve to a terminal state
- failures must emit at least one error-level job event
- the admin UI must be able to distinguish “job failed before write” from “job partially applied and then failed”
- manual sync endpoints must return actionable error detail without leaking secrets

## Testing Strategy

This sub-project requires tests at four levels:

1. persistence tests
   - department hierarchy persistence
   - primary membership enforcement
   - sync job / event / snapshot / diff persistence
2. sync service tests
   - full sync creates users, departments, and memberships
   - department sync replaces only scoped memberships
   - user patch sync updates one user without unrelated churn
   - manual disable survives later active syncs
   - disabled / departed DingTalk states disable local users
3. admin API tests
   - auth guard behavior
   - sync trigger routes
   - user local-settings update behavior
   - read-only separation of synced vs local fields
4. admin UI tests
   - overview navigation into users and org sync views
   - manual sync triggers
   - user local field editing
   - read-only synced field presentation

## Implementation Notes

- Reuse the existing DingTalk client module and extend it with organization-fetch methods rather than creating a second DingTalk integration stack.
- Keep sync normalization, diffing, persistence, and scheduling in separate units so scheduled and manual flows stay identical.
- Keep role assignment limited to the existing role set in this phase.
- Keep organization sync provider-specific objects behind a DingTalk adapter so another identity provider could be introduced later without contaminating admin routes.

## Rollout

Recommended rollout sequence:

1. add schema and repositories
2. add DingTalk organization adapter and sync service
3. add manual sync admin APIs
4. add scheduled sync execution
5. add admin user and department APIs
6. add admin UI views
7. run end-to-end verification with seeded DingTalk fixtures or mocked API responses

## Open Decisions Resolved In This Spec

The following scope questions are intentionally fixed here so implementation does not reopen them:

- sync supports full, department, and single-user scopes
- scheduled sync cadence is configurable and defaults to once per day
- department sync includes the tree, memberships, and primary department markers
- manager relationships are out of scope
- admin manual disable overrides DingTalk re-enable
- DingTalk-owned profile fields are read-only in admin UI
- full role / permission editing is deferred to a separate sub-project
