# Engagement Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Broadcast Management into an engagement campaign workspace with audience rules, branded email templates, identical test sending, publish confirmation, and delivery tracking.

**Architecture:** Keep the existing `#admin/broadcasts` and `/api/admin/broadcasts` surface. Extend `broadcast_messages` with JSON campaign fields, reuse `notification_records` and `inbox_items` for delivery audit, and add focused backend helpers for audience resolution and email rendering.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL, React, Ant Design, existing admin CSS tokens, existing `AuthEmailSender`, existing portal branding resolver.

## Global Constraints

- Admin UI uses admin console tokens; user-visible HTML email uses portal/runtime branding.
- Test email and formal email use the same renderer and sender path; only the delivery recipient changes.
- Keep old broadcast records readable and publishable as in-app broadcasts.
- Do not hardcode Bailey branding in templates; use published system settings and `APP_BASE_URL`.
- Exclude disabled users, users without email, and users with marketing opt-out from email delivery.

---

### Task 1: Schema And Repository Extension

**Files:**
- Modify: `agent-api/prisma/schema.prisma`
- Create: `agent-api/prisma/migrations/20260708090000_extend_broadcast_campaigns/migration.sql`
- Modify: `agent-api/src/persistence/broadcast-repository.ts`

**Interfaces:**
- Produces: extended `BroadcastRecord` with `channels`, `content`, `audience`, `audienceSnapshot`, `testState`, and `deliverySummary`.
- Produces: `markTested()`, `updateAudienceSnapshot()`, `updateDeliverySummary()`.

- [ ] Add nullable JSON fields and channel booleans to `broadcast_messages`.
- [ ] Map missing JSON fields to safe defaults so old broadcasts still work.
- [ ] Add repository methods to update test state, audience snapshot, and delivery summary.
- [ ] Add repository tests through service tests rather than standalone DB tests.

### Task 2: Audience Resolution

**Files:**
- Create: `agent-api/src/collaboration/broadcast-audience.ts`
- Create: `agent-api/src/collaboration/broadcast-audience.test.ts`

**Interfaces:**
- Consumes: `BroadcastAudienceConfig`.
- Produces: `BroadcastAudienceResolver.preview(config)` returning count, sample recipients, distribution, excluded counts, and full recipient records for sending.

- [ ] Support include rules: all users, organization type, organization, department with child option, user, role.
- [ ] Support exclude rules: user, organization, department, role.
- [ ] Apply email exclusions: disabled users, missing email, marketing opt-out.
- [ ] Return a stable snapshot for audit.

### Task 3: Branded Email Renderer

**Files:**
- Create: `agent-api/src/collaboration/broadcast-email-template.ts`
- Create: `agent-api/src/collaboration/broadcast-email-template.test.ts`

**Interfaces:**
- Consumes: broadcast content, recipient profile, portal branding, portal base URL.
- Produces: `{ subject, text, html, fingerprint }`.

- [ ] Render escaped HTML with portal logo/name/assistant, CTA, footer, and plain text fallback.
- [ ] Do not put “test” labels into the rendered email body.
- [ ] Compute a content fingerprint used to decide whether a previous test is still valid.

### Task 4: Broadcast Service Actions

**Files:**
- Modify: `agent-api/src/collaboration/broadcast-service.ts`
- Modify: `agent-api/src/admin/broadcast-router.ts`
- Modify: `agent-api/src/index.ts`
- Create: `agent-api/src/collaboration/broadcast-service.test.ts`

**Interfaces:**
- Produces: `previewAudience()`, `sendTestEmail()`, extended `publish()`.
- API: `POST /api/admin/broadcasts/:broadcastId/audience-preview`
- API: `POST /api/admin/broadcasts/:broadcastId/test-email`
- API: `GET /api/admin/broadcasts/:broadcastId/deliveries`

- [ ] Wire resolver, email renderer, email sender, notification repository, system settings, and portal base URL.
- [ ] Test send uses simulated recipient variables but sends to admin test inbox.
- [ ] Publish requires successful current test when email channel is enabled.
- [ ] Publish writes inbox items, email notification records, optional DingTalk records, and delivery summary.

### Task 5: Frontend Types And API

**Files:**
- Modify: `agent-ui/src/features/collaboration/types.ts`
- Modify: `agent-ui/src/features/collaboration/api.ts`

**Interfaces:**
- Produces typed methods for campaign CRUD, audience preview, test email, publish, and delivery logs.

- [ ] Add audience/content/channel/test/delivery types.
- [ ] Preserve old target input compatibility.
- [ ] Add API methods for the new endpoints.

### Task 6: Admin Workspace UI

**Files:**
- Replace: `agent-ui/src/features/collaboration/BroadcastAdminView.tsx`
- Modify: `agent-ui/src/features/admin/AdminShell.tsx`
- Modify: `agent-ui/src/features/admin/admin-console.css`

**Interfaces:**
- Consumes APIs from Task 5.
- Produces `运营触达` overview, editor wizard, audience builder, test step, publish confirmation, and delivery detail.

- [ ] Rename menu metadata from “广播管理” to “运营触达”.
- [ ] Build overview with KPI row, filters, campaign list, and selected detail panel.
- [ ] Build wizard steps: content, audience, test send, publish confirmation.
- [ ] Email preview uses current frontend branding context for visual parity and backend renderer for actual test/publish.
- [ ] Disable publish until email test is current.

### Task 7: Verification

**Files:**
- Test command targets only relevant files where possible.

- [ ] Run backend tests for broadcast audience, template, and service.
- [ ] Run frontend build.
- [ ] Run backend build; if unrelated dirty code blocks build, record exact unrelated failure.
