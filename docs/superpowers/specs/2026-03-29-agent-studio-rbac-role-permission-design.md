# Agent Studio RBAC Role, Permission, And Unified Authorization Design

## Context

The cloud foundation, workspace / knowledge-set management, mode / skill / run-profile management, and DingTalk organization sync sub-projects are complete:

- persistent users, departments, roles-as-strings, sessions, and resources exist
- `resource_policies` already govern runtime and resource-instance authorization at role, department, and user scope
- the admin console now supports users, departments, and org sync operations
- backend admin access is still enforced mostly through hardcoded role checks such as `requireRole("admin")`
- user role assignment is still a single string field rather than a first-class RBAC model

This creates two gaps:

1. function-level backend and admin-console authorization is still hardcoded and difficult to evolve safely
2. administrators cannot manage roles, permissions, and resource authorization from one coherent control surface

The next sub-project closes those gaps by introducing first-class RBAC models for roles, permissions, and user-role assignment while preserving `resource_policies` as the existing resource-instance authorization layer.

## Goals

1. Introduce first-class `roles`, `permissions`, `role_permissions`, and `user_roles` models.
2. Support multiple roles per user with a single primary role marker.
3. Replace hardcoded function authorization with permission-based checks for new and migrated admin surfaces.
4. Keep `resource_policies` as the source of truth for resource-instance authorization.
5. Expose role permissions and resource authorization from one unified admin experience.
6. Support system roles and custom roles with safe lifecycle rules.
7. Support role duplication, role disablement, and user-role assignment from the admin console.
8. Add durable admin audit logs for role, permission, and authorization changes.
9. Make permission changes affect new requests immediately while preserving existing runtime session snapshots.
10. Keep the design compatible with the existing single-tenant enterprise deployment while preserving future multi-tenant expansion points.

## Non-Goals

This phase explicitly does not include:

- replacing `resource_policies` with a new authorization table
- attribute-based access control
- approval workflow for role changes
- external customer tenant isolation
- SCIM or external identity providers beyond DingTalk
- runtime-session retroactive permission rewrites
- a generalized enterprise IAM service outside Agent Studio

## Product Behavior

### Admin behavior

Administrators can:

- browse system roles and custom roles
- create custom roles
- copy an existing role into a new custom role
- disable a custom role
- view and edit function permissions granted to a role
- view and edit resource-instance authorization for a role from the same role detail page
- assign multiple roles to a user
- choose one primary role for a user
- view audit history for role and authorization changes

Administrators cannot:

- delete or demote the system `super_admin` role
- delete or demote the system `admin` role
- turn a custom role into a system role
- mutate runtime snapshots already attached to active sessions

### System-role behavior

This phase defines two system roles:

- `super_admin`
- `admin`

Rules:

- system roles cannot be deleted
- system roles cannot be converted into custom roles
- `super_admin` always retains full function access
- `admin` starts with broad management permissions but remains represented through first-class permission assignments rather than only hardcoded checks

`employee` may still exist as a default built-in role template, but it is not treated as an immutable protected system role in this phase.

### User-role behavior

Users may have more than one role.

Rules:

- each user may have multiple assigned roles
- exactly zero or one role is marked as `primary`
- effective function permissions are the union of all active assigned roles
- primary role is used for:
  - default role display in the admin console
  - default role context where legacy logic still expects a single role string
  - migration compatibility while the codebase transitions away from single-role assumptions

### Permission-change behavior

Permission and role changes affect:

- new HTTP requests immediately
- new admin-console reads immediately
- new portal and runtime resolution requests immediately

They do not affect:

- already-running runtime sessions
- already-materialized session permission snapshots

This keeps request-time authorization current without violating the session-snapshot principle already established in the platform design.

## Core Design

### Two-layer authorization model

Authorization remains split into two layers:

1. function permissions
2. resource-instance authorization

Function permissions answer:

- can this user enter the admin console?
- can this user manage users?
- can this user view audit logs?
- can this user edit role assignments?

Resource-instance authorization answers:

- which workspaces can this role administer or use?
- which knowledge sets can this role administer or use?
- which agent modes, skill packages, or run profiles can this role access?

This phase introduces a proper RBAC model only for the first layer.
The second layer continues to use `resource_policies`.

### Unified management surface with split storage

The admin console should present role permissions and resource authorization together in one role-detail workflow, but the storage model remains intentionally split:

- function permissions live in `permissions` and `role_permissions`
- resource-instance authorization continues to live in `resource_policies`

This avoids duplicating resource authorization logic, avoids forcing one table to represent two different concepts, and preserves the policy engine already used by workspace / knowledge-set and mode / skill authorization.

### System permissions and extension permissions

Permission points come from two sources:

- built-in system permissions, defined and seeded by the application
- optional custom extension permissions, created for future integrations or enterprise-specific actions

Core platform behavior must not depend on ad hoc permission strings created at runtime. That means built-in permissions remain the authoritative set for the main product modules.

### Legacy compatibility model

The codebase currently assumes a single string role in multiple places.
This phase must support a safe transition rather than a flag day rewrite.

Compatibility rules:

- `user.role` remains available during the migration window
- primary role mirrors the legacy `user.role` for compatibility where required
- new permission checks should prefer `requirePermission(...)`
- existing role-gated areas may be migrated incrementally
- `super_admin` remains a bypass role for management authorization during this phase

This lets RBAC land without destabilizing portal or runtime behavior that still expects a single role identifier in some request paths.

## Data Model

### Role

`roles`

- `id`
- `organization_id`
- `slug`
- `name`
- `description`
- `is_system`
- `is_active`
- `created_at`
- `updated_at`

Rules:

- `slug` is unique per organization
- system roles are seeded during migration/bootstrap
- disabling a role prevents new assignments and removes it from normal selection lists, but historical audit records still reference it

### Permission

`permissions`

- `id`
- `key`
- `name`
- `description`
- `category`
- `is_system`
- `is_active`
- `created_at`
- `updated_at`

Recommended built-in categories:

- `admin_overview`
- `user_management`
- `role_management`
- `resource_authorization`
- `org_sync`
- `integration_management`
- `audit`

Examples of built-in keys:

- `admin.overview.read`
- `user.read`
- `user.write`
- `user.role.assign`
- `role.read`
- `role.write`
- `role.clone`
- `role.disable`
- `permission.read`
- `permission.assign`
- `resource_policy.read`
- `resource_policy.write`
- `org_sync.read`
- `org_sync.trigger`
- `integration.read`
- `integration.write`
- `audit.read`

Custom extension permissions are allowed, but they should use a namespaced key convention such as:

- `custom.<domain>.<action>`

### Role-permission binding

`role_permissions`

- `id`
- `role_id`
- `permission_id`
- `created_at`
- `updated_at`

Rules:

- unique on `(role_id, permission_id)`
- function permissions are evaluated by union across active assigned roles

### User-role binding

`user_roles`

- `id`
- `user_id`
- `role_id`
- `is_primary`
- `created_at`
- `updated_at`

Rules:

- users may have many active role assignments
- at most one active assignment is primary per user
- unique on `(user_id, role_id)`
- role disablement does not remove historical assignment rows automatically, but disabled roles should stop contributing active authorization unless explicitly preserved for audit views only

### Audit log

`admin_audit_logs`

- `id`
- `organization_id`
- `actor_user_id`
- `action_type`
- `target_type`
- `target_id`
- `before_payload`
- `after_payload`
- `metadata`
- `created_at`

Examples of auditable actions:

- role created
- role updated
- role cloned
- role disabled
- role permissions replaced
- user roles replaced
- role resource policies replaced

## Permission Evaluation

### Function permission evaluation

A request is authorized when any of these are true:

1. requester has role `super_admin`
2. requester has an active assigned role with the requested permission

Evaluation inputs:

- user id
- active assigned role ids
- permission key

Evaluation output:

- allow or deny

### Resource authorization evaluation

Resource authorization remains unchanged in principle.

The policy engine continues to evaluate `resource_policies` across:

- role scope
- department scope
- user scope

The new RBAC layer only changes how administrators manage role-related resource authorization in the admin UI. It does not replace the underlying policy service.

## Backend Design

### Repositories and services

Add first-class repository/service boundaries for:

- role repository
- permission repository
- user-role repository
- role-permission repository
- admin audit log repository
- permission evaluation service

The permission evaluation service should be separate from the resource policy service. They solve different problems and should stay independently testable.

### Request guards

Introduce a permission-based guard such as:

```ts
requirePermission("role.write")
```

Migration rules:

- keep `requireRole("admin")` where immediate migration is not yet complete
- all new RBAC management endpoints should use `requirePermission(...)`
- preserve `super_admin` bypass semantics in the new guard

### Admin APIs

Add endpoints such as:

- `GET /api/admin/roles`
- `POST /api/admin/roles`
- `GET /api/admin/roles/:roleId`
- `PATCH /api/admin/roles/:roleId`
- `POST /api/admin/roles/:roleId/clone`
- `POST /api/admin/roles/:roleId/disable`
- `GET /api/admin/roles/:roleId/permissions`
- `PUT /api/admin/roles/:roleId/permissions`
- `GET /api/admin/roles/:roleId/resource-policies`
- `PUT /api/admin/roles/:roleId/resource-policies`
- `GET /api/admin/roles/:roleId/members`
- `GET /api/admin/permissions`
- `GET /api/admin/users/:userId/roles`
- `PUT /api/admin/users/:userId/roles`
- `GET /api/admin/audit-logs`

### Write behavior

Critical write operations should replace full assignment sets atomically where appropriate.

Examples:

- replacing the permissions assigned to a role
- replacing the role set assigned to a user
- replacing the role-scoped resource policies attached to a role detail page

This keeps admin intent deterministic and easier to audit.

## Frontend Design

### New admin module

Add a dedicated admin area for `角色权限`.

Recommended navigation:

- overview
- users
- organization
- roles

### Role list

The role list should show:

- role name
- slug
- system/custom marker
- active/disabled status
- member count
- permission count

Primary actions:

- create role
- clone role
- disable role
- open details

### Role detail

The role detail page should be organized with tabs:

- basic information
- function permissions
- resource authorization
- members
- audit history

The resource authorization tab should surface the existing `resource_policies` relevant to that role, grouped by resource type.

### User role assignment UX

User management should evolve from editing one role string to editing:

- assigned roles list
- primary role selector
- local manual disable flag
- admin note

The UI must prevent:

- duplicate role assignments
- multiple primary roles
- selecting disabled roles for new assignment

## Audit Design

Every role and permission write performed from the admin console must emit an audit record.

At minimum the system should capture:

- actor
- action type
- target type and id
- before payload
- after payload
- timestamp

Audit records should be readable from the admin console but not editable.

## Migration And Compatibility

### Initial seed behavior

Seed the following system roles if missing:

- `super_admin`
- `admin`

Seed built-in permission points if missing.

Seed baseline bindings so:

- `super_admin` effectively has all built-in permissions
- `admin` has the expected current admin-console management permissions

### User migration behavior

For existing users:

- create a user-role binding from current `user.role`
- mark that binding primary
- preserve `user.role` for compatibility until the rest of the app is fully migrated

### Runtime compatibility

Portal and runtime resource resolution can continue deriving `roleIds` from the legacy primary role string during this phase where necessary, but new code should prefer assigned active roles. The migration path should be incremental, not all-at-once.

## Security Rules

- only authorized users may read or mutate RBAC data
- role disablement must not remove audit history
- system roles cannot be deleted
- system roles cannot be downgraded into custom roles
- permissions should be validated against existing system or extension permission keys
- resource authorization edits made from the role detail page must still flow through existing policy validation logic
- role changes affect new requests immediately but not active runtime snapshots

## Testing Strategy

### Backend tests

Add tests for:

- seeding system roles and permissions
- assigning multiple roles to a user with one primary role
- permission evaluation through union of roles
- `super_admin` bypass behavior
- rejection of invalid role assignment states
- role clone behavior
- role disable behavior
- admin audit log creation for RBAC writes
- admin API permission enforcement
- role-detail resource-policy replacement limited to the selected role scope

### Frontend tests

Add tests for:

- role list rendering
- role create / clone / disable flows
- permission matrix editing
- user multi-role assignment with primary-role selection
- role detail tab switching
- audit log rendering
- disabled roles excluded from assignment pickers

### Verification

Before claiming completion:

- run backend tests
- run backend build
- run Prisma generate
- run frontend tests
- run frontend build

## Open Decisions Resolved In This Spec

The following decisions are fixed for this phase:

- system roles are `super_admin` and `admin`
- function permissions are modeled separately from resource-instance authorization
- resource-instance authorization continues to use `resource_policies`
- user-role assignment supports multiple roles with one primary role
- permission changes affect new requests immediately
- role detail pages unify function permissions and resource authorization in one admin workflow
- role / permission changes are auditable

## Summary

This phase upgrades Agent Studio from a partial role-string model to a true RBAC foundation:

- first-class roles
- first-class permissions
- multiple role assignments per user
- permission-based admin authorization
- unified role detail management for function permissions and resource authorization
- durable audit history

It does so without destabilizing the existing resource policy engine or runtime-session permission snapshot model.
