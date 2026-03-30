# Agent Studio Resource Configuration Center Design

## Context

The following platform foundations are already implemented on `codex/cloud-foundation`:

- cloud persistence and session storage
- DingTalk-backed authentication
- workspace and knowledge-set persistence models
- managed-upload filesystem storage for knowledge sets
- resource authorization through `resource_policies`
- agent mode / skill package / run profile backend models
- organization sync and RBAC admin surfaces
- audit / monitoring / quota admin APIs and admin console

What is still missing is an admin-operable resource management surface. The platform can already store workspaces and knowledge sets, but administrators cannot yet manage those resources through a complete console.

This sub-project adds a first-class admin resource configuration center.

## Goals

1. Add a unified admin entry for governed resource management.
2. Make `workspace` and `knowledge_set` manageable from the admin console.
3. Let admins create, edit, enable, and disable workspaces.
4. Let admins create, edit, enable, and disable knowledge sets.
5. Let admins bind knowledge sets to workspaces as `default` or `optional`.
6. Let admins edit resource authorization for workspaces and knowledge sets at:
   - role
   - department
   - user
   and for both `allow` and `deny` effects.
7. Let admins operate on managed-upload knowledge sets with:
   - multi-file upload
   - archive upload and extraction
   - rebuild / re-import operations
   - file tree inspection
   - single-file delete and rename
8. Let admins operate on filesystem knowledge sets with controlled in-place file operations inside the configured root path:
   - single-file delete
   - single-file rename
   - re-scan / rebuild inventory
9. Keep the console structure extensible so later phases can add:
   - agent modes
   - skill packages
   - run profiles
   without redesigning the admin navigation.

## Non-Goals

This phase does not include:

- vector indexing or search
- online document editing
- approval workflows
- batch dangerous file operations
- bulk authorization tooling
- full integration-center implementation
- system-settings implementation
- collaborative authoring or review workflows
- multi-tenant external-customer isolation

## Product Shape

## Resource Configuration Center

A new admin module is introduced: `资源配置中心`.

The center has one unified shell with:

- a resource-type switcher
- a searchable resource list for the active type
- type-specific filters
- a single details workspace on the right

Phase one resource types:

- `workspace`
- `knowledge_set`

Phase-one shell also reserves space for future types:

- `agent_mode`
- `skill_package`
- `run_profile`

These future types are visible only as structural placeholders in the design, not implemented in this phase.

## Page Organization

### Left rail

The left side provides:

- resource type switcher
- search box
- filters:
  - status
  - type
- resource list for the selected type
- “create” action for the active type

For `workspace`:

- type filter may be minimal because phase one only uses `filesystem`
- status filter supports `active` and `disabled`

For `knowledge_set`:

- type filter supports:
  - `filesystem`
  - `managed_upload`
- status filter supports `active` and `disabled`

### Right detail panel

The right side displays the selected resource editor.

The editor is not a separate page tree. It is a workbench-style detail view so admins can manage relationships and file content without constant route hopping.

## Workspace Management

### Admin capabilities

For a workspace, admins can:

- create
- edit basic metadata
- configure root directory mapping
- enable / disable
- bind default knowledge sets
- bind optional knowledge sets
- edit authorization policies
- inspect high-level binding and authorization summaries

### Workspace fields

Phase-one editable fields:

- `name`
- `slug`
- `description`
- `status`
- `root_path`

Phase-one status values:

- `active`
- `disabled`

### Disable semantics

Disabling a workspace means:

- it is no longer available for new employee sessions
- it remains in persistence
- existing historical session data is preserved
- bindings and authorization policies are preserved
- admins may later re-enable it

Phase one does not support physical deletion of workspaces.

### Workspace knowledge-set bindings

Workspace detail includes an embedded knowledge-set binding manager.

Admins can:

- attach knowledge sets as `default`
- attach knowledge sets as `optional`
- remove an attached knowledge set from the workspace
- see binding summaries directly inside workspace detail

Behavior:

- `default` knowledge sets are auto-mounted for employee sessions using that workspace
- `optional` knowledge sets are shown as selectable additions in the employee portal if authorized

## Knowledge Set Management

### Admin capabilities

For a knowledge set, admins can:

- create
- edit metadata
- configure source type and backing location
- enable / disable
- inspect file inventory as a directory tree
- upload files into managed uploads
- upload archives into managed uploads and automatically extract them
- rebuild / rescan file inventory
- clear and rebuild inventory from current source contents
- edit authorization policies
- delete a single file
- rename a single file

### Knowledge-set types

Phase one supports:

- `filesystem`
- `managed_upload`

#### `filesystem`

Represents a directory already present on the server.

Editable fields:

- `name`
- `slug`
- `description`
- `status`
- `root_path`

Admins may perform in-place file operations only within the configured root path.

#### `managed_upload`

Represents files stored under platform-managed storage.

Editable fields:

- `name`
- `slug`
- `description`
- `status`
- `storage_key` (normally internal/admin-visible)

Managed-upload contents are stored through the existing storage abstraction. The current concrete backend remains filesystem-backed.

## File Inventory Model

The current implementation already stores knowledge-set items with `relativePath`. This allows a tree-shaped admin presentation.

### Inventory presentation

The knowledge-set detail page must render a directory-aware file tree rather than a flat list.

Each file row shows:

- display name
- relative path
- size
- source archive name when present
- updated time in the admin user's local timezone

### Directory hierarchy

Directory hierarchy is supported.

This is true for both source types:

- `filesystem` uses the actual directory structure under `root_path`
- `managed_upload` writes files into an actual directory structure and preserves nested archive paths during extraction

### File operations

Phase one supports only single-file operations:

- delete one file
- rename one file

It does not support:

- batch delete
- batch move
- directory delete
- root directory delete

## Filesystem Safety Rules

Because filesystem knowledge sets may modify real server files, strict guardrails are required.

### Path safety

All filesystem file operations must:

- resolve against the configured knowledge-set root
- reject absolute target paths from the UI
- reject any path traversal outside the configured root
- reject operations targeting the root directory itself
- reject null-byte or malformed paths

### Operation scope

Phase one allows only:

- single-file delete
- single-file rename
- inventory rebuild / rescan

No recursive destructive operation is allowed from the UI.

### UX safeguards

Filesystem delete and rename require:

- RBAC permission checks
- explicit confirmation in the UI
- audit logging of who did what and when

This phase does not introduce approval flows.

## Authorization Editing

The resource center exposes authorization editing directly in resource details.

### Supported subjects

- role
- department
- user

### Supported effects

- `allow`
- `deny`

### Scope

The resource center manages authorization for:

- `workspace`
- `knowledge_set`

The underlying source of truth remains the existing `resource_policies` model.

The UI is an editor over that existing model, not a replacement authorization system.

### Effective behavior

The platform continues to use merged policy evaluation.

For phase one, the admin UI must make explicit that:

- policies may be granted by role, department, or direct user assignment
- `deny` rules are explicit constraints and are editable

## Functional Permissions

This sub-project requires explicit admin capability permissions in addition to existing resource policies.

Recommended phase-one permissions:

- `resource_center.read`
- `workspace.read`
- `workspace.write`
- `workspace.disable`
- `knowledge_set.read`
- `knowledge_set.write`
- `knowledge_set.upload`
- `knowledge_set.reindex`
- `knowledge_set.file_manage`

Meaning:

- functional permissions decide whether an admin may access or operate the resource center
- resource policies still determine which concrete resources they may manage or use

## API Requirements

If the existing resource admin API surface is insufficient, phase one extends it under the admin namespace.

### Workspace APIs

- `GET /api/admin/resources/workspaces`
- `POST /api/admin/resources/workspaces`
- `PATCH /api/admin/resources/workspaces/:id`
- `GET /api/admin/resources/workspaces/:id/knowledge-sets`
- `PUT /api/admin/resources/workspaces/:id/knowledge-sets`

### Knowledge-set APIs

- `GET /api/admin/resources/knowledge-sets`
- `POST /api/admin/resources/knowledge-sets`
- `PATCH /api/admin/resources/knowledge-sets/:id`
- `GET /api/admin/resources/knowledge-sets/:id/items`
- `POST /api/admin/resources/knowledge-sets/:id/files`
- `POST /api/admin/resources/knowledge-sets/:id/archive`
- `POST /api/admin/resources/knowledge-sets/:id/rebuild`
- `DELETE /api/admin/resources/knowledge-sets/:id/items`
- `PATCH /api/admin/resources/knowledge-sets/:id/items`

### Authorization APIs

- `GET /api/admin/resources/:resourceType/:id/policies`
- `PUT /api/admin/resources/:resourceType/:id/policies`

The exact route shapes may follow existing admin router conventions if nearby code already establishes a better pattern, but the functional coverage above is required.

## UI Behavior

### Resource list behavior

Admins can:

- search by name or slug
- filter by status
- filter by type where applicable
- create a new resource of the active type
- switch the selected resource without leaving the center

### Detail workbench behavior

Detail views are workbench-style and should keep related operations on one screen:

- metadata edit
- relationship edit
- authorization edit
- file operations where applicable

### Time rendering

All timestamps in the frontend follow the admin user's local timezone.

This includes:

- file timestamps
- upload timestamps
- rebuild timestamps
- policy and binding timestamps when shown

### Empty states

The resource center must provide clear empty states for:

- no resources yet
- no search matches
- no files in a knowledge set
- no policies configured

## Audit Expectations

This phase uses the already established audit / monitoring foundation.

At minimum, these actions must write auditable records:

- workspace create / edit / disable
- knowledge-set create / edit / disable
- knowledge-set upload
- archive extraction
- rebuild / rescan
- filesystem file delete
- filesystem file rename
- policy changes
- workspace knowledge-set binding changes

The exact destination may use existing admin audit logging and resource access logging according to current platform patterns, but the actions above must not be silent.

## Data and Runtime Consistency

This sub-project must not change employee runtime semantics.

The runtime contract remains:

- workspace stays the primary runtime workspace
- selected and default knowledge sets resolve to mounted readable directories
- resource policies remain the authorization source of truth

This project only adds a proper admin operating surface over those already-implemented models.

## Phased Implementation Boundary

Phase one delivers:

- unified resource center shell
- complete workspace operations listed above
- complete knowledge-set operations listed above
- file tree presentation
- controlled filesystem file actions
- authorization editing

Phase one does not deliver:

- mode / skill / run profile admin pages
- integration center
- system settings
- approvals
- collaboration workflows

## Success Criteria

This sub-project is complete when:

1. admins can manage workspaces from the UI
2. admins can manage knowledge sets from the UI
3. workspace-to-knowledge-set bindings are editable from workspace detail
4. managed-upload content can be uploaded and rebuilt from the UI
5. filesystem knowledge sets can perform safe single-file delete and rename within root boundaries
6. role / department / user allow/deny resource policies are editable from the UI
7. all affected timestamps display in local timezone
8. existing portal and runtime behavior remain unchanged for employees
9. new resource operations are covered by backend and frontend tests
