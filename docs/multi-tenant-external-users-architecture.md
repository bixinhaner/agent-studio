# Multi-Tenant External User Architecture

## Scope

This document defines the target architecture for evolving Agent Studio from an internal DingTalk-only employee system into a long-lived multi-tenant product that supports external customer organizations and their users.

The goal is to finish design before implementation so the next phase can be executed incrementally without reworking the data model or security boundaries.

## Current State Summary

The current codebase is still single-tenant at the authentication and request-context layers even though several domain tables already expose an optional `organizationId`.

Key observations from the repository:

- Authentication only supports DingTalk login through `/api/auth/dingtalk/*`.
- Frontend login only exposes "Use DingTalk login".
- `User` is modeled as a single platform user record with DingTalk-specific fields baked in.
- `currentUser` only carries user identity, not tenant context.
- Access control depends on legacy role, user-role assignments, and department memberships, all resolved without an active organization.
- Several content/config tables already expose `organizationId`, but core conversational data such as `Thread` and `RuntimeSession` are not tenant-scoped.

This means the code can express some tenant-owned configuration, but request execution, session ownership, and authorization still behave like one internal organization.

## Goals

- Support many customer organizations over the long term.
- Support both internal employees and external customer users.
- Preserve internal DingTalk SSO for employees.
- Add external, low-friction authentication without introducing local password management.
- Enforce tenant isolation for data, runtime, quotas, audit, and admin actions.
- Allow platform operators to manage the whole system while keeping customer admins scoped to their organization.
- Keep the rollout incremental so current internal users continue to work during migration.

## Non-Goals

- Self-service public signup in phase 1.
- Cross-organization sharing of threads or resources.
- Custom per-customer SAML/OIDC on day 1.
- Full billing implementation in the first migration.

## Design Principles

- Separate identity from membership. A person logs in as a platform user, then acts inside one or more organizations through memberships.
- Make tenant context explicit on every request. Do not infer tenant from email domain or resource ownership.
- Default-deny across tenant boundaries.
- Keep platform-owned system templates/configuration separate from tenant-owned overrides.
- Avoid password authentication. Use DingTalk, magic link, and later standards-based OIDC/SAML.
- Prefer additive migrations and dual-read or dual-write rollout over big-bang replacement.

## Target Domain Model

### 1. Platform User

`User` remains the stable platform person/account record.

Proposed semantics:

- One row per human actor across the whole platform.
- No longer tied to a single identity provider.
- May belong to multiple organizations.
- May have a platform-level actor type:
  - `internal_employee`
  - `external_user`
  - `service_account` (future)

The existing legacy `role` field should be retained only for migration compatibility, then phased down into platform-level flags or roles.

### 2. Authentication Identity

Introduce `AuthIdentity` as the source-of-truth login binding.

Proposed fields:

- `id`
- `userId`
- `provider`
  - `dingtalk`
  - `email_magic_link`
  - `oidc`
- `providerSubject`
- `email`
- `emailVerifiedAt`
- `profileJson`
- `lastLoginAt`
- `createdAt`
- `updatedAt`

Constraints:

- Unique `(provider, providerSubject)`
- Optional unique `(provider, email)` where applicable

Rationale:

- Removes DingTalk-specific coupling from `User`.
- Allows a single person to authenticate through more than one provider.
- Creates a clean path for customer-specific OIDC later.

### 3. Organization

Introduce `Organization` as the tenant root.

Proposed fields:

- `id`
- `slug`
- `name`
- `status`
  - `active`
  - `suspended`
  - `disabled`
- `type`
  - `internal`
  - `customer`
- `ownerUserId` optional
- `settingsJson`
- `createdAt`
- `updatedAt`

Rules:

- The internal Baicells organization should be represented explicitly as one `Organization`.
- Every external customer should be a separate `Organization`.

### 4. Organization Membership

Introduce `OrganizationMembership` to connect users to organizations.

Proposed fields:

- `id`
- `organizationId`
- `userId`
- `membershipType`
  - `employee`
  - `customer_admin`
  - `customer_member`
  - `guest`
- `status`
  - `active`
  - `invited`
  - `suspended`
  - `revoked`
- `displayNameOverride` optional
- `title` optional
- `invitedByUserId` optional
- `joinedAt`
- `createdAt`
- `updatedAt`

Constraints:

- Unique `(organizationId, userId)`

This is the primary authorization anchor. A logged-in user can only act inside organizations where an active membership exists.

### 5. Organization Role Assignment

Current RBAC tables already support `organizationId` on `Role`. Keep that direction and make it explicit.

Recommended structure:

- Platform roles remain global with `organizationId = NULL`.
- Customer roles are organization-scoped.
- `UserRole` should be interpreted within organization context.

To support that cleanly, add `organizationId` to `UserRole`, or replace it with `OrganizationRoleAssignment`.

Recommended end state:

- `OrganizationRoleAssignment`
  - `organizationId`
  - `userId`
  - `roleId`
  - `isPrimary`

This avoids ambiguous role assignment when the same user belongs to multiple organizations.

### 6. Invite Flow

Introduce `OrganizationInvite`.

Proposed fields:

- `id`
- `organizationId`
- `email`
- `inviteTokenHash`
- `intendedProvider`
  - `email_magic_link`
  - `oidc`
- `roleTemplate`
- `status`
  - `pending`
  - `accepted`
  - `expired`
  - `revoked`
- `expiresAt`
- `invitedByUserId`
- `acceptedByUserId` optional
- `createdAt`
- `updatedAt`

Rules:

- External access begins with invitation, not open signup.
- Invite acceptance creates or links `User`, `AuthIdentity`, and `OrganizationMembership`.

## Authentication Architecture

## Internal Employees

Internal employees continue to authenticate through DingTalk.

Flow:

1. User starts DingTalk login.
2. Backend exchanges code for DingTalk identity.
3. Backend resolves or creates `User` through `AuthIdentity(provider=dingtalk)`.
4. Backend resolves the internal organization membership.
5. Session is issued with selectable organization context.

Internal users may also hold platform-level admin privileges.

## External Customer Users

Phase 1 authentication method:

- Email magic link or one-time code.

Why:

- Minimal operational overhead.
- No password reset, password storage, or password policy burden.
- Works across many customer organizations immediately.

Future optional methods:

- Per-organization OIDC.
- SAML via a broker if needed later.

## Session Model

Current session cookies only carry `userId`. That is insufficient for multi-tenant execution.

Target session payload:

- `userId`
- `sessionVersion`
- `activeOrganizationId`
- `authenticationStrength`
- `issuedAt`
- `expiresAt`

Notes:

- The active organization can be switched by the user only among memberships they hold.
- Organization switching must invalidate cached authorization context on the frontend.
- Platform admins may operate in a platform console without an active customer organization, but tenant admin APIs must still require one.

## Request Context

Extend request context from `req.currentUser` to a richer actor context:

- `currentUser`
- `currentOrganization`
- `currentMembership`
- `effectivePlatformRoles`
- `effectiveOrganizationRoleIds`
- `departmentIds`

Department handling:

- Only internal organization users should participate in department-based access.
- External organizations should not rely on the internal department tree.

## Authorization Model

Authorization should be layered.

### Platform Layer

Used for:

- Global administration
- Tenant provisioning
- Global monitoring
- Platform-wide templates and defaults

Actors:

- Platform super admin
- Platform operations/admin

These actors are internal employees only.

### Organization Layer

Used for:

- Customer admin console
- Tenant-local roles
- Tenant resource management
- Tenant quotas, usage, alerts, integrations

Actors:

- Customer org admin
- Customer org member

### Resource Layer

Existing `ResourcePolicy` already supports `role`, `department`, and `user`.

Target usage:

- Internal organization:
  - role
  - department
  - user
- External customer organization:
  - role
  - user
  - no department dependency by default

Required change:

- All policy evaluation must include active `organizationId`.
- A policy row can only affect resources inside the same organization unless it is explicitly global and platform-managed.

## Tenant Isolation Model

## Data Categories

### Global Platform Data

These may remain `organizationId = NULL`:

- Platform admin roles
- System permissions
- Global system defaults/templates
- Internal operational metadata that does not belong to one customer

### Tenant-Owned Data

These must carry `organizationId`:

- Threads
- Messages, if not inferred through thread joins in all access paths
- Runtime sessions
- Thread shares, comments, assignments, followers, inbox items
- Knowledge sets and workspaces intended for customers
- Run profiles, skill packages, agent modes when customer-specific
- Quotas, alerts, usage, integrations
- Audit logs for tenant actions

### Internal-Only Org Data

These remain scoped to the internal organization:

- DingTalk department tree
- Org sync jobs
- DingTalk user attributes

## Mandatory Core Schema Changes

The following current tenant gaps must be closed before general customer rollout:

- `User` lacks actor type and first-class tenant membership.
- `Thread` has no `organizationId`.
- `RuntimeSession` must become tenant-scoped.
- Collaboration and inbox models hanging off threads should inherit tenant scope directly or through strict join enforcement.
- `UserRole` is ambiguous without organization context.
- Session cookies do not include active tenant context.

## Proposed Schema Additions

Minimum new models:

- `Organization`
- `OrganizationMembership`
- `AuthIdentity`
- `OrganizationInvite`
- `OrganizationRoleAssignment` or `UserRole.organizationId`
- `LoginChallenge` for magic links or one-time codes

Minimum new columns:

- `User.userType`
- `User.primaryOrganizationId` optional convenience pointer
- `Thread.organizationId`
- `RuntimeSession.organizationId`
- `ThreadShare.organizationId`
- `ThreadComment.organizationId`
- `ThreadAssignment.organizationId`
- `ThreadFollower.organizationId`
- `InboxItem.organizationId`

Recommended later columns for simpler filtering:

- `Message.organizationId`
- `KnowledgeCaptureMark.organizationId`

## Runtime and Workspace Isolation

Customer organizations must not share writable runtime workspaces by default.

Required rules:

- Session workspaces should be rooted by organization, then by thread or session.
- Uploaded files should be stored under organization-scoped paths.
- Any generated export should be organization-scoped.
- Background jobs must include organization context.

Recommended path pattern:

- `sessions/<organization-slug>/<thread-id>/...`
- `uploads/<organization-slug>/<session-id>/...`

## Monitoring, Quota, and Billing

The codebase already supports `organizationId` on several monitoring tables. The missing step is propagating tenant context consistently from request entrypoints.

Target behavior:

- Every usage event emitted from a tenant session must include `organizationId`.
- Quota evaluation should run first at organization scope, then optionally user scope.
- Monitoring dashboards for tenant admins must filter to their own organization only.
- Platform monitoring can aggregate all organizations.

## Integration Model

Customer integrations must be organization-scoped by default.

Rules:

- `IntegrationInstance.organizationId` must be required for customer-managed integrations.
- Global singleton integrations remain platform-only.
- Secret rotation and validation history must enforce organization boundary checks.

## Frontend Experience

## Login Entry

Replace the current single login button with provider-aware entry:

- Internal employees: DingTalk
- External users: Email login

If the request comes from an invite link, the UI should route directly into the invite acceptance flow.

## Organization Switcher

If a user belongs to multiple organizations:

- Show an organization switcher after login.
- Persist the selected organization in the session.
- Reload navigation, policies, runtime options, and quotas after switch.

## Console Separation

Recommend three surfaces:

- Platform admin console
- Tenant admin console
- End-user portal

Platform and tenant admin surfaces should not share authorization assumptions.

## Security Requirements

- Invite tokens must be stored hashed, never plaintext.
- Magic links must be single-use and short-lived.
- Session fixation protections must remain in place when switching organization.
- All admin writes must record actor user id, actor organization id, and target organization id.
- Cross-organization resource identifiers must never be guessable enough to bypass authorization by URL manipulation alone.

## Migration Strategy

Use incremental migration rather than hard cutover.

### Phase A

- Add new organization and identity tables.
- Backfill one internal organization.
- Link all existing users into that organization.
- Keep legacy auth and role paths working.

### Phase B

- Add `organizationId` to core conversational tables.
- Backfill existing internal data.
- Start writing organization context on all new writes.

### Phase C

- Introduce external invite and email login.
- Add tenant admin surface.
- Gate external organizations behind a feature flag.

### Phase D

- Move authorization and policy evaluation to organization-aware paths only.
- Remove dependency on legacy single-tenant assumptions.

## Key Decisions

- Use invitation-first external access.
- Use passwordless external auth in phase 1.
- Represent internal staff and external customers as separate organizations under one platform.
- Keep a single `User` per person across organizations and identity providers.
- Make active organization part of the session and request context.
- Tenant-scope core conversation/runtime data before opening customer access.

## Implementation Readiness Criteria

Implementation should not start until the following are accepted:

- Tenant model and ownership rules
- Session payload contract
- User and identity model
- Organization-scoped RBAC direction
- Backfill and rollout order
- Decision on whether `UserRole` is extended or replaced

The companion implementation document maps these decisions to concrete file changes in this repository.
