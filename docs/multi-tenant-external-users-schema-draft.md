# Multi-Tenant External User Schema Draft

## Purpose

This document is a pre-implementation schema draft. It is not meant to be pasted directly into Prisma, but it is concrete enough to drive migration design with minimal ambiguity.

## Core New Models

```prisma
model Organization {
  id             String   @id @default(cuid())
  slug           String   @unique
  name           String
  type           String   @default("customer")
  status         String   @default("active")
  ownerUserId    String?  @map("owner_user_id")
  settingsJson   Json?    @map("settings_json")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@index([type, status])
  @@map("organizations")
}

model OrganizationMembership {
  id                 String   @id @default(cuid())
  organizationId     String   @map("organization_id")
  userId             String   @map("user_id")
  membershipType     String   @default("customer_member") @map("membership_type")
  status             String   @default("active")
  displayNameOverride String? @map("display_name_override")
  title              String?
  invitedByUserId    String?  @map("invited_by_user_id")
  joinedAt           DateTime? @map("joined_at")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@unique([organizationId, userId])
  @@index([userId, status])
  @@index([organizationId, status])
  @@map("organization_memberships")
}

model AuthIdentity {
  id               String   @id @default(cuid())
  userId           String   @map("user_id")
  provider         String
  providerSubject  String   @map("provider_subject")
  email            String?
  emailVerifiedAt  DateTime? @map("email_verified_at")
  profileJson      Json?    @map("profile_json")
  lastLoginAt      DateTime? @map("last_login_at")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  @@unique([provider, providerSubject])
  @@index([userId, provider])
  @@index([email])
  @@map("auth_identities")
}

model OrganizationInvite {
  id               String   @id @default(cuid())
  organizationId   String   @map("organization_id")
  email            String
  inviteTokenHash  String   @map("invite_token_hash")
  intendedProvider String   @default("email_magic_link") @map("intended_provider")
  roleTemplate     Json?    @map("role_template")
  status           String   @default("pending")
  expiresAt        DateTime @map("expires_at")
  invitedByUserId  String?  @map("invited_by_user_id")
  acceptedByUserId String?  @map("accepted_by_user_id")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  @@index([organizationId, status])
  @@index([email, status])
  @@map("organization_invites")
}

model LoginChallenge {
  id             String   @id @default(cuid())
  channel        String
  targetRef      String   @map("target_ref")
  challengeHash  String   @map("challenge_hash")
  purpose        String
  organizationId String?  @map("organization_id")
  inviteId       String?  @map("invite_id")
  expiresAt      DateTime @map("expires_at")
  consumedAt     DateTime? @map("consumed_at")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@index([targetRef, purpose, expiresAt])
  @@index([organizationId, purpose])
  @@map("login_challenges")
}

model OrganizationRoleAssignment {
  id             String   @id @default(cuid())
  organizationId String   @map("organization_id")
  userId         String   @map("user_id")
  roleId         String   @map("role_id")
  isPrimary      Boolean  @default(false) @map("is_primary")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@unique([organizationId, userId, roleId])
  @@index([organizationId, userId, isPrimary])
  @@index([roleId])
  @@map("organization_role_assignments")
}
```

## Core Existing Model Changes

```prisma
model User {
  id                   String   @id @default(cuid())
  userType             String   @default("internal_employee") @map("user_type")
  primaryOrganizationId String? @map("primary_organization_id")
}

model Thread {
  organizationId String @map("organization_id")
}

model RuntimeSession {
  organizationId String @map("organization_id")
}

model ThreadShare {
  organizationId String @map("organization_id")
}

model ThreadComment {
  organizationId String @map("organization_id")
}

model ThreadPublicShare {
  organizationId String @map("organization_id")
}

model ThreadAssignment {
  organizationId String @map("organization_id")
}

model ThreadFollower {
  organizationId String @map("organization_id")
}

model InboxItem {
  organizationId String @map("organization_id")
}

model KnowledgeCaptureMark {
  organizationId String @map("organization_id")
}
```

## Ownership Rules

### Global rows with nullable `organizationId`

These may continue to allow `organizationId = NULL`:

- platform roles
- system permissions
- platform-wide templates and defaults
- system singleton integrations

### Tenant-owned rows

These should become non-null after rollout:

- threads and runtime sessions
- collaboration records
- tenant integrations
- tenant policies
- tenant usage and alert records
- tenant-owned resources and modes

## Backfill Defaults

Backfill all existing legacy data to a newly created internal organization.

Defaults:

- all existing users -> `user_type = internal_employee`
- all existing threads -> internal organization id
- all existing runtime sessions -> internal organization id
- all existing collaboration and inbox rows -> internal organization id
- all existing DingTalk-linked users -> one `AuthIdentity(provider=dingtalk, providerSubject=unionId)`

## Recommended Indexes For Performance

Add or confirm:

- `threads (organization_id, created_at)`
- `threads (organization_id, user_id, created_at)`
- `runtime_sessions (organization_id, created_at)`
- `runtime_sessions (organization_id, user_id, created_at)`
- `thread_shares (organization_id, thread_id, created_at)`
- `thread_comments (organization_id, thread_id, created_at)`
- `inbox_items (organization_id, user_id, status, created_at)`
- `organization_memberships (user_id, status)`
- `organization_memberships (organization_id, status)`
- `organization_role_assignments (organization_id, user_id)`
- `auth_identities (provider, provider_subject)`

## Query Rule Changes

All repository methods for tenant-owned entities should move to one of these signatures:

- `getById(id, organizationId)`
- `listForOrganization(organizationId, ...)`
- `create({ organizationId, ... })`
- `update(id, organizationId, ...)`

Avoid repository methods that can read tenant-owned rows by primary key without organization context unless they are used only behind a guaranteed join scoped by tenant.

## Session Contract Draft

The signed session cookie payload should evolve toward:

```ts
type SessionCookiePayload = {
  userId: string;
  activeOrganizationId?: string;
  issuedAt: number;
  expiresAt: number;
  sessionVersion: number;
};
```

Notes:

- `activeOrganizationId` may be absent only for platform-only admin views or the short window immediately after login before org selection.
- `sessionVersion` gives a clean path for future invalidation.

## Migration Safety Notes

- Add new columns as nullable first where required for backfill.
- Backfill in SQL or a migration script before adding not-null constraints.
- Dual-write old and new role structures during the migration window if needed.
- Do not remove DingTalk-specific columns from `users` until org sync and internal login have fully moved to `AuthIdentity`.
