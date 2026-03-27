# Agent Studio Workspace And Knowledge Set Design

## Context

The cloud foundation phase is complete:

- persistent thread and session storage exists
- DingTalk-backed user identity exists
- admin and portal shells exist
- Zendesk settings already moved into shared persistence

The next sub-project adds governed resource management for:

- logical workspaces
- knowledge sets
- policy-based authorization
- admin-managed uploaded knowledge content

This sub-project does not implement skill packages, agent-mode publishing, vector retrieval, or workflow approvals.

## Goals

1. Add a first-class workspace model instead of relying only on `WORKSPACE_WHITELIST`.
2. Add a first-class knowledge set model with two initial types:
   - `filesystem`
   - `managed_upload`
3. Support authorization at three levels:
   - role
   - department
   - user
4. Let each workspace define:
   - default attached knowledge sets
   - optional knowledge sets a user may additionally select
5. Let administrators upload and maintain managed knowledge-set content with:
   - multi-file batch upload
   - archive upload and automatic extraction
6. Expose portal APIs so employees can:
   - choose an authorized workspace
   - see default mounted knowledge sets
   - add optional authorized knowledge sets

## Non-Goals

This phase explicitly does not include:

- vector embeddings
- semantic retrieval pipelines
- online document editor
- Git-backed knowledge sets
- object-storage production adapter
- skill package and agent mode publishing
- approval workflows
- collaborative authoring

## Product Behavior

### Admin behavior

Admins can:

- create and edit workspaces
- create and edit knowledge sets
- upload files into managed knowledge sets
- upload archives into managed knowledge sets and let the server expand them
- bind knowledge sets to workspaces as `default` or `optional`
- define authorization rules for workspaces and knowledge sets at role, department, and user level

### Employee behavior

When an employee starts a session:

- they see only authorized workspaces
- selecting a workspace shows the default knowledge sets already attached to it
- they may additionally select optional knowledge sets that are authorized for them
- they do not see unauthorized knowledge sets
- they do not see backend storage details such as real server paths for managed uploads

### Runtime behavior

When the portal creates or updates a session:

- the selected workspace remains the primary runtime workspace
- default knowledge sets are always mounted
- optional selected knowledge sets are additionally mounted
- the backend translates authorized resources into concrete readable directories for the runtime

## Core Design

### Resource model

Resources split into two logical types:

- `workspace`
- `knowledge_set`

A workspace is the primary working environment. It is where the runtime operates.

A knowledge set is auxiliary reference material. It is mounted read-only into the runtime and may come from:

- an existing filesystem directory
- platform-managed uploaded files

### Knowledge set types

#### `filesystem`

Represents a directory already present on the server.

Fields include:

- display name
- description
- root path
- status
- source type = `filesystem`

The path is stored in persistence and only visible to admins.

#### `managed_upload`

Represents files stored and maintained by the platform.

Fields include:

- display name
- description
- managed storage root
- status
- source type = `managed_upload`

The implementation uses a storage abstraction. The first concrete adapter is a filesystem-backed adapter. The abstraction is designed so object storage can replace it later without changing the product model.

## Data Model

### Workspace

`workspaces`

- `id`
- `organization_id`
- `name`
- `slug`
- `description`
- `status` (`active | disabled`)
- `source_type` (`filesystem` for phase one)
- `root_path`
- `created_at`
- `updated_at`

Notes:

- `organization_id` is retained for future multi-tenant expansion.
- `root_path` is admin-only metadata.

### Knowledge set

`knowledge_sets`

- `id`
- `organization_id`
- `name`
- `slug`
- `description`
- `status` (`active | disabled`)
- `source_type` (`filesystem | managed_upload`)
- `root_path`
- `storage_key`
- `created_at`
- `updated_at`

Rules:

- `filesystem` knowledge sets use `root_path`.
- `managed_upload` knowledge sets use `storage_key` and platform-managed storage.

### Knowledge set items

`knowledge_set_items`

- `id`
- `knowledge_set_id`
- `kind` (`file | directory`)
- `relative_path`
- `display_name`
- `mime_type`
- `size_bytes`
- `checksum`
- `source_archive_name`
- `created_at`
- `updated_at`

Purpose:

- tracks the file inventory after upload or archive extraction
- supports future auditing and indexing without redesigning the schema

### Workspace bindings

`workspace_knowledge_sets`

- `id`
- `workspace_id`
- `knowledge_set_id`
- `mount_type` (`default | optional`)
- `created_at`
- `updated_at`

Meaning:

- `default`: automatically mounted for the workspace
- `optional`: user may add it if also authorized

### Resource policies

`resource_policies`

- `id`
- `organization_id`
- `subject_type` (`role | department | user`)
- `subject_id`
- `resource_type` (`workspace | knowledge_set`)
- `resource_id`
- `effect` (`allow | deny`)
- `created_at`
- `updated_at`

This table handles all three authorization layers.

### Departments

The existing department/user sync model from DingTalk will be reused. This sub-project does not redesign department sync; it only consumes department identities for policy evaluation.

## Authorization Model

### Evaluation order

The portal computes access using these sources:

- role policies
- department policies
- user policies

Recommended evaluation rule:

1. collect all matching `allow`
2. collect all matching `deny`
3. `deny` wins over `allow`
4. explicit user policy has the highest precision, but `deny` still wins globally

This keeps policy behavior deterministic.

### Effective workspace access

A workspace is visible only if:

- it is `active`
- the user is effectively allowed
- the user is not effectively denied

### Effective knowledge-set access

A knowledge set is visible or mountable only if:

- it is `active`
- the user is effectively allowed
- the user is not effectively denied
- if workspace-scoped in the portal flow, it is also bound to the selected workspace as `default` or `optional`

## Storage Design

### Storage abstraction

Introduce a backend interface such as `KnowledgeSetStorage` with capabilities:

- `ensureKnowledgeSetRoot()`
- `saveFiles()`
- `extractArchive()`
- `listItems()`
- `deleteItem()`
- `deleteAll()`
- `resolveReadableMountPath()`

### First implementation

`FilesystemKnowledgeSetStorage`

- stores managed uploads under a configured root such as `temp/knowledge-sets/<knowledge_set_id>` during early phase deployment
- produces a stable readable mount path for runtime use
- records extracted file inventory into `knowledge_set_items`

### Archive handling

Phase one supports archive upload for managed knowledge sets.

Expected behavior:

- admin uploads a zip archive
- backend expands it into the managed knowledge-set root
- backend refreshes `knowledge_set_items`
- backend normalizes paths and rejects path traversal attempts

The first implementation only guarantees zip support. Additional archive formats can be added later.

## API Design

### Admin APIs

#### Workspaces

- `GET /api/admin/workspaces`
- `POST /api/admin/workspaces`
- `PATCH /api/admin/workspaces/:workspaceId`

#### Knowledge sets

- `GET /api/admin/knowledge-sets`
- `POST /api/admin/knowledge-sets`
- `PATCH /api/admin/knowledge-sets/:knowledgeSetId`
- `GET /api/admin/knowledge-sets/:knowledgeSetId/items`
- `POST /api/admin/knowledge-sets/:knowledgeSetId/files`
- `POST /api/admin/knowledge-sets/:knowledgeSetId/archive`
- `DELETE /api/admin/knowledge-sets/:knowledgeSetId/items/*`

#### Workspace bindings

- `GET /api/admin/workspaces/:workspaceId/knowledge-sets`
- `PUT /api/admin/workspaces/:workspaceId/knowledge-sets`

#### Resource policies

- `GET /api/admin/resource-policies`
- `PUT /api/admin/resource-policies`

### Portal APIs

Add a dedicated resource endpoint instead of overloading `/api/portal/runtime-options`.

- `GET /api/portal/resources`

Response shape:

- authorized workspaces
- for each workspace:
  - default knowledge sets
  - optional knowledge sets authorized for the user

This keeps runtime-profile concerns separate from resource-selection concerns.

## Runtime Integration

### Portal flow

The employee portal uses `/api/portal/resources` to render:

- workspace selector
- default knowledge-set list
- optional knowledge-set checklist

### Session flow

When the session is created or refreshed, the frontend sends:

- selected `workspace_id` or mapped workspace path
- selected optional knowledge-set ids

The backend resolves those ids to concrete runtime mount paths and injects them into the runtime configuration as additional readable directories.

### Compatibility strategy

To avoid a full runtime rewrite in this phase:

- the existing `workspace` field remains the primary runtime directory
- selected knowledge sets are translated into `additionalDirectories`
- this keeps the Codex runtime contract stable while moving product behavior to logical resources

## Admin UI Scope

Phase one admin UI should be basic and sufficient, not polished.

### Required pages

- workspace list and edit form
- knowledge-set list and edit form
- managed-upload page with batch file upload and archive upload
- workspace binding editor
- resource policy editor

### Not required yet

- drag-and-drop knowledge tree editor
- inline document editor
- preview renderer for every file type
- advanced bulk operations

## Portal UI Scope

Phase one portal changes should be limited to resource selection.

### Required changes

- replace direct workspace list from runtime options with portal resource response
- show default knowledge sets as already attached
- allow optional knowledge sets to be checked within the authorized set
- send selected optional knowledge sets on session creation/update

### Not required yet

- full knowledge browsing UI
- search inside knowledge sets
- per-file previews

## Security And Validation

### Filesystem safety

For `filesystem` resources:

- all paths must still resolve under the global whitelist or a future managed root policy
- backend must normalize and validate all configured paths

### Upload safety

For `managed_upload` resources:

- reject path traversal during archive extraction
- normalize filenames and relative paths
- enforce upload size limits
- keep managed knowledge-set roots read-only to the runtime where possible

### Authorization safety

- all admin writes require admin role
- portal resource responses only return effective authorized resources
- session creation must re-check authorization server-side, not trust frontend selection

## Testing Strategy

### Backend

Add tests for:

- workspace repository CRUD
- knowledge-set repository CRUD
- knowledge-set item refresh after batch upload and archive extraction
- resource policy evaluation with role, department, and user scopes
- deny-overrides-allow behavior
- portal resource response for different users
- admin binding endpoints

### Frontend

Add tests for:

- portal resource selector rendering
- default knowledge-set display
- optional knowledge-set selection
- unauthorized resources not shown

## Delivery Strategy

Recommended implementation order:

1. Prisma models and migration
2. repositories for workspace, knowledge set, item, binding, and policy
3. storage abstraction and filesystem adapter
4. admin APIs
5. portal resource API
6. portal UI integration
7. regression tests

## Open Follow-On Work

This design intentionally leaves room for later sub-projects:

- skill package binding to workspaces and knowledge sets
- agent mode binding to workspaces and knowledge sets
- object storage adapter
- indexing and retrieval
- audit and quota integration

## Decision Summary

Confirmed decisions for this sub-project:

- knowledge-set types: `filesystem + managed_upload`
- managed uploads use a storage abstraction, with filesystem adapter first
- authorization is supported at role, department, and user levels
- employee portal behavior is:
  - default knowledge sets auto-mounted
  - user may add authorized optional knowledge sets
- managed knowledge sets support:
  - multi-file batch upload
  - archive upload and automatic extraction
