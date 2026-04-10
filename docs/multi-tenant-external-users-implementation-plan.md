# Multi-Tenant External User Implementation Plan

## Purpose

This document translates the target architecture into concrete implementation preparation for the current repository.

It is intentionally biased toward the existing code structure so development can begin without another design pass.

## Repository Impact Summary

Primary affected areas:

- `agent-api/prisma/schema.prisma`
- `agent-api/src/auth/*`
- `agent-api/src/persistence/*`
- `agent-api/src/app-routes.ts`
- `agent-api/src/index.ts`
- `agent-api/src/portal/*`
- `agent-api/src/admin/*`
- `agent-api/src/resources/*`
- `agent-api/src/integrations/*`
- `agent-ui/src/features/auth/*`
- `agent-ui/src/App.tsx`
- `agent-ui/src/features/admin/*`
- `agent-ui/src/features/portal/*`

## Current Gaps Mapped to Code

### 1. Authentication is single-provider

Current code:

- `agent-api/src/auth/router.ts`
- `agent-ui/src/features/auth/AuthProvider.tsx`
- `agent-ui/src/features/auth/api.ts`
- `agent-ui/src/App.tsx`

Gap:

- Only DingTalk config/session endpoints exist.
- Frontend bootstrap only understands DingTalk callback parameters.

Required prep:

- Introduce provider-neutral auth service boundaries.
- Define email magic-link flow endpoints.
- Add invite-aware auth UX contract.

### 2. User persistence is DingTalk-centric

Current code:

- `agent-api/src/persistence/user-repository.ts`
- `agent-api/prisma/schema.prisma`

Gap:

- `upsertFromDingTalk` is the primary write path.
- `User` stores DingTalk identifiers directly.

Required prep:

- Define generic identity repository operations.
- Split identity binding from business user record.
- Keep DingTalk columns temporarily for migration compatibility.

### 3. Request context has no active organization

Current code:

- `agent-api/src/auth/current-user.ts`
- `agent-api/src/auth/session-cookie.ts`
- `agent-api/src/app-routes.ts`

Gap:

- Session cookie only carries `userId`.
- `req.currentUser` contains no tenant membership or active organization.

Required prep:

- Extend session payload.
- Add organization resolution middleware.
- Update authorization middleware signatures.

### 4. Core conversation data is not tenant-scoped

Current code:

- `Thread` and related models in `schema.prisma`
- thread, session, collaboration, inbox, and portal routes

Gap:

- `Thread` lacks `organizationId`.
- Runtime sessions and thread collaboration flows do not consistently carry tenant context.

Required prep:

- Add tenant ownership to conversation models.
- Define backfill rules for all legacy rows.
- Update repositories and route contracts to require org context on writes.

### 5. User-role assignment is ambiguous for multi-org users

Current code:

- `agent-api/src/persistence/user-role-repository.ts`
- `agent-api/src/rbac/permission-service.ts`

Gap:

- Role assignment is user-scoped without clear tenant scoping.

Required prep:

- Decide between:
  - adding `organizationId` to `UserRole`
  - introducing `OrganizationRoleAssignment`

Recommended decision:

- Introduce `OrganizationRoleAssignment`.
- Keep `UserRole` only as legacy compatibility during migration if necessary.

### 6. Admin UI assumes internal identity shape

Current code:

- `agent-ui/src/features/admin/UsersView.tsx`
- `agent-ui/src/features/admin/types.ts`

Gap:

- User list and filters assume DingTalk IDs and departments.

Required prep:

- Redesign user governance payloads around:
  - actor type
  - auth providers
  - memberships
  - tenant roles

## Target Data Model Preparation

## New Models

Prepare migrations for:

### `Organization`

Minimum columns:

- `id`
- `slug`
- `name`
- `type`
- `status`
- `owner_user_id`
- `settings`
- timestamps

### `OrganizationMembership`

Minimum columns:

- `id`
- `organization_id`
- `user_id`
- `membership_type`
- `status`
- `invited_by_user_id`
- `joined_at`
- timestamps

Indexes:

- unique `(organization_id, user_id)`
- index `(user_id, status)`

### `AuthIdentity`

Minimum columns:

- `id`
- `user_id`
- `provider`
- `provider_subject`
- `email`
- `email_verified_at`
- `profile`
- `last_login_at`
- timestamps

Indexes:

- unique `(provider, provider_subject)`
- index `(user_id, provider)`
- index `(email)`

### `OrganizationInvite`

Minimum columns:

- `id`
- `organization_id`
- `email`
- `invite_token_hash`
- `intended_provider`
- `role_template`
- `status`
- `expires_at`
- `invited_by_user_id`
- `accepted_by_user_id`
- timestamps

### `LoginChallenge`

Purpose:

- passwordless login challenge storage for magic links or one-time codes

Minimum columns:

- `id`
- `channel`
- `target_ref`
- `challenge_hash`
- `purpose`
- `organization_id` optional
- `invite_id` optional
- `expires_at`
- `consumed_at`
- timestamps

## Modified Models

### `User`

Add:

- `userType`
- `primaryOrganizationId` optional

Retain temporarily:

- DingTalk columns for migration and internal sync support

### `Thread`

Add:

- `organizationId`

Backfill:

- existing legacy rows -> internal organization id

### `RuntimeSession`

Add:

- `organizationId`

### Collaboration-related models

Add `organizationId` to simplify authorization and analytics:

- `ThreadShare`
- `ThreadComment`
- `ThreadAssignment`
- `ThreadFollower`
- `ThreadPublicShare`
- `InboxItem`
- `KnowledgeCaptureMark`

### `UserRole` replacement

Recommended:

- introduce `OrganizationRoleAssignment`
- avoid dual meaning of one role assignment across many organizations

## Migration Sequence

### Migration 1: Tenant Foundation

- create `organizations`
- create `organization_memberships`
- create `auth_identities`
- create `organization_invites`
- create `login_challenges`
- add `user_type` and `primary_organization_id` to `users`

Backfill tasks:

- create internal organization row
- create membership rows for all existing users into internal organization
- set existing users to `internal_employee`
- create auth identity rows for existing DingTalk-linked users

### Migration 2: Tenant Scope on Runtime Data

- add `organization_id` to `threads`
- add `organization_id` to `runtime_sessions`
- add `organization_id` to thread collaboration models

Backfill tasks:

- set all existing data to internal organization
- add indexes on `(organization_id, created_at)` for key tables

### Migration 3: Tenant-Aware RBAC

- create `organization_role_assignments`
- backfill from legacy `user_roles`
- update role management services to require organization context for org roles

### Migration 4: Tighten Constraints

After dual-write period:

- enforce non-null `organization_id` on tenant-owned tables
- retire single-tenant assumptions from auth and authorization code

## Backend Refactor Plan

## Auth Layer

Files:

- `agent-api/src/auth/router.ts`
- `agent-api/src/auth/current-user.ts`
- `agent-api/src/auth/session-cookie.ts`

Preparation tasks:

- Extract provider-neutral auth service interface.
- Add identity resolution methods:
  - `resolveUserByIdentity`
  - `createOrLinkIdentity`
- Add organization selection endpoints:
  - `GET /api/auth/organizations`
  - `POST /api/auth/organizations/select`
- Add external auth endpoints:
  - `POST /api/auth/email/request`
  - `POST /api/auth/email/verify`
- Add invite endpoints:
  - `GET /api/auth/invites/:token`
  - `POST /api/auth/invites/:token/accept`

Session payload target:

- `userId`
- `activeOrganizationId`
- `issuedAt`
- `expiresAt`

Middleware target:

- `req.currentUser`
- `req.currentOrganization`
- `req.currentMembership`

## Persistence Layer

Files:

- `agent-api/src/persistence/user-repository.ts`
- new repositories for organizations, identities, invites, memberships

Preparation tasks:

- Move DingTalk upsert into a provider adapter.
- Add generic user bootstrap flow.
- Add org membership listing and active-org validation methods.

## Authorization Layer

Files:

- `agent-api/src/rbac/permission-service.ts`
- `agent-api/src/auth/permission-guard.ts`
- `agent-api/src/resources/policy-service.ts`

Preparation tasks:

- Require active organization for org-scoped permission checks.
- Ensure policy filtering considers organization boundary before subject matching.
- Restrict department resolution to internal organization only.

Required rule:

- A user-level allow in org A must never grant access in org B even if `userId` is the same.

## Portal and Thread Routes

Files:

- `agent-api/src/portal/router.ts`
- `agent-api/src/index.ts`
- thread and collaboration route blocks in `agent-api/src/index.ts`

Preparation tasks:

- Require `currentOrganization` for all tenant portal APIs.
- Ensure thread create/list/read/update/delete queries filter by `organizationId`.
- Emit `organizationId` into usage, audit, notification, and resource access events.

## Resources, Modes, Integrations

Files:

- `agent-api/src/resources/*`
- `agent-api/src/integrations/*`
- `agent-api/src/admin/*`

Preparation tasks:

- Distinguish platform-managed resources from tenant-managed resources.
- Add organization filtering to list endpoints.
- Ensure customer admins cannot view or mutate resources from other organizations.

## Frontend Refactor Plan

## Auth UX

Files:

- `agent-ui/src/App.tsx`
- `agent-ui/src/features/auth/AuthProvider.tsx`
- `agent-ui/src/features/auth/api.ts`

Preparation tasks:

- Replace single-path bootstrap with provider-neutral auth state machine.
- Add support for:
  - DingTalk callback
  - email verification callback
  - invite acceptance entry
- Add organization picker after login for multi-org users.

## Admin UX

Files:

- `agent-ui/src/features/admin/*`

Preparation tasks:

- Split platform admin and tenant admin views.
- Update user table payloads:
  - base profile
  - identity providers
  - memberships
  - org roles
  - status by organization

## Portal UX

Files:

- `agent-ui/src/features/portal/*`

Preparation tasks:

- Display active organization in top navigation.
- Reset runtime options after organization switch.
- Prevent stale data leakage between org switches.

## API Contract Preparation

Define stable contracts before implementation begins.

### `GET /api/auth/whoami`

Return:

- `user`
- `activeOrganization`
- `memberships`
- `platformPermissions`

### `POST /api/auth/organizations/select`

Input:

- `organizationId`

Result:

- refreshed session
- active organization summary

### `POST /api/auth/email/request`

Input:

- `email`
- `inviteToken` optional

Result:

- challenge accepted response without account enumeration

### `POST /api/auth/email/verify`

Input:

- `email`
- `code` or `token`

Result:

- authenticated session
- resolved organization list

### Admin tenant management endpoints

New platform-admin APIs:

- create organization
- suspend or disable organization
- invite customer admin
- list org memberships

## Rollout Strategy

## Phase 0: Implementation Guardrails

Before feature coding:

- freeze schema direction
- agree on migration order
- agree on API response shapes
- decide org-role assignment model

## Phase 1: Internal Tenantization

Ship without external customers yet.

Success criteria:

- internal org exists
- all current data backfilled to internal org
- no behavior regression for DingTalk users

## Phase 2: External Access Foundation

Ship invite flow and email login behind flags.

Success criteria:

- invited external users can log in
- external users only see their organization
- no platform or internal admin leakage

## Phase 3: Tenant Admin Console

Success criteria:

- customer admins can manage memberships and roles in their org
- customer admins can manage tenant-scoped resources and integrations

## Phase 4: Hardening

Success criteria:

- all tenant-owned tables enforce non-null `organizationId`
- all critical queries include org scope
- audit and usage pipelines include organization consistently

## Security Review Checklist

- verify all read paths enforce `organizationId`
- verify all write paths enforce `organizationId`
- verify organization switch invalidates cached portal data
- verify invite and magic-link tokens are hashed and single-use
- verify no admin endpoint allows org spoofing from client input alone
- verify public shares remain intentionally public and never expose hidden tenant metadata
- verify logs and monitoring do not mix tenant data in customer-visible UIs

## Test Plan Preparation

Required automated coverage to schedule before implementation completes:

- auth provider tests
- invite acceptance tests
- organization switch tests
- cross-org access denial tests
- tenant admin vs platform admin permission tests
- backfill migration verification
- portal thread isolation tests
- usage event organization propagation tests

## Chosen Defaults For Implementation

The following decisions are treated as fixed defaults for implementation unless product requirements change later:

1. Use `OrganizationRoleAssignment` instead of extending `UserRole`.
2. Allow multi-organization membership from day 1.
3. Do not support platform-admin impersonation in phase 1.
4. Keep public share support, but attach all related records to an `organizationId` and audit creation or revocation.
5. Defer customer-specific OIDC until after invite plus email login is stable.

## Definition of "Ready to Implement"

The project is ready for coding when:

- these documents are accepted
- Prisma migration order is accepted
- API contract list is accepted
- active organization session design is accepted
- platform admin vs tenant admin scope is accepted

At that point implementation can begin safely in phased pull requests.
