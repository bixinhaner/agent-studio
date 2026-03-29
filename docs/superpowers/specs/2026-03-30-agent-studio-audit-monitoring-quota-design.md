# Agent Studio Audit, Monitoring, Quota, And Alerting Design

## Context

The cloud foundation, workspace / knowledge-set management, mode / skill / run-profile management, DingTalk organization sync, and RBAC sub-projects are complete:

- persistent users, departments, roles, sessions, threads, resources, and mode data exist
- employee and admin shells exist
- RBAC admin audit logs already capture management mutations
- the portal already parses per-thread runtime usage snapshots
- resource authorization already exists through `resource_policies`

The current gap is operational governance.

There is still no first-class platform subsystem for:

- resource access logs
- usage and estimated cost events
- platform and department quota policies
- alert rules and alert events
- internal notifications and DingTalk alert delivery
- admin monitoring dashboards

This sub-project closes that gap by adding a unified audit / monitoring / quota foundation for internal enterprise operations.

## Goals

1. Add first-class resource access logging with session and thread context.
2. Add first-class usage and estimated cost event capture.
3. Add daily usage rollups for platform, user, department, model, and feature dimensions.
4. Add configurable cost profiles so administrators can maintain model pricing and internal cost coefficients.
5. Add quota policies with:
   - platform-level default rules
   - department-level overrides
6. Add alert rules and alert events for:
   - quota thresholds
   - error rate or failure rate
   - security events
7. Add alert delivery through:
   - admin monitoring views
   - internal notification records
   - DingTalk notifications
8. Apply soft blocking for new sessions and new costly actions when quotas are exceeded.
9. Add admin monitoring pages for:
   - platform overview
   - user and department rankings
   - model and feature splits
   - trend charts
   - resource access logs
   - quota rules
   - alert center

## Non-Goals

This phase explicitly does not include:

- full APM or distributed tracing
- user-level quota override rules
- external BI exports
- approval workflow implementation
- multi-tenant isolation
- external customer observability partitions
- full workflow analytics for every future integration

## Product Behavior

### Admin behavior

Administrators can:

- view platform-wide token and estimated cost trends
- rank usage by user and department
- inspect usage by model and feature dimension
- inspect resource access logs with session and thread context
- create and edit platform quota rules
- create and edit department quota overrides
- maintain model pricing and internal cost coefficients
- create and edit alert rules
- view triggered alert events
- view notification delivery records

Administrators cannot:

- retroactively alter historical usage or access events
- define user-level quota exceptions in this phase
- hard-kill already running sessions via quota enforcement in this phase

### Employee behavior

Employees are affected indirectly.

When an employee creates a new session or triggers a controlled high-cost action:

- the platform evaluates applicable quota rules
- if the request is within quota, execution proceeds
- if the request exceeds a soft-limit rule, the platform rejects the new action with a controlled response
- already-running sessions are not terminated by quota enforcement

Employees do not get direct access to the monitoring console in this phase.

### Alert behavior

The platform supports three alert families:

- quota alerts
- reliability alerts
- security alerts

Alert delivery targets:

- admin monitoring views
- internal notification records
- DingTalk notifications

### Cost behavior

The platform records:

- token usage
- estimated cost by model pricing
- adjusted internal cost by administrator-maintained coefficient

This allows operations to compare raw model cost with internal accounting policy.

## Core Design

### Split operational event model

Operational governance requires two distinct event streams:

1. resource access events
2. usage and cost events

These should not be collapsed into a single table.

Resource access records answer:

- which protected resource was touched
- by whom
- through which session or thread
- with what action type
- and with what result

Usage records answer:

- which request or operation consumed tokens or cost
- by whom
- under which model
- under which feature dimension
- and whether the operation succeeded

### Rollup-first analytics approach

The system should keep raw events and also maintain rollups.

Raw events are required for:

- auditability
- debugging
- detailed drill-down

Rollups are required for:

- efficient dashboards
- rankings
- trend charts
- quota evaluation over recent windows

This phase uses daily rollups as the first aggregation boundary.

### Quota scope model

Quota rules support:

- platform-level defaults
- department-level overrides

No user-level override exists in this phase.

Evaluation order:

1. find applicable department rule, if one exists
2. otherwise use platform default rule
3. if no matching rule exists, allow the action

### Soft-blocking model

Quota enforcement applies only to new actions.

The platform may soft-block:

- creating a new session
- starting a new expensive execution path
- launching a new controlled operation such as search, file processing, or sync

The platform does not:

- kill already-running sessions
- revoke already-issued runtime snapshots

This preserves user experience stability while still giving operations meaningful control.

### Feature-dimension model

The first-phase feature dimensions are:

- `chat`
- `search`
- `file`
- `tool`
- `sync`
- `admin`

This is intentionally coarser than per-tool analytics, but detailed enough to separate major cost and risk drivers.

## Data Model

### Resource access logs

`resource_access_logs`

- `id`
- `organization_id`
- `user_id`
- `department_id_snapshot`
- `thread_id`
- `session_id`
- `resource_type`
- `resource_id`
- `action_type` (`read | write | mount | upload | download | deny`)
- `result_status` (`success | denied | failed`)
- `metadata`
- `created_at`

Purpose:

- durable audit trail for resource interaction
- security alert input
- drill-down source for the monitoring console

### Usage events

`usage_events`

- `id`
- `organization_id`
- `user_id`
- `department_id_snapshot`
- `thread_id`
- `session_id`
- `model`
- `feature_type` (`chat | search | file | tool | sync | admin`)
- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `estimated_cost`
- `internal_cost`
- `result_status` (`success | failed`)
- `metadata`
- `created_at`

Purpose:

- raw source of token and cost telemetry
- quota evaluation input
- dashboard drill-down source

### Usage daily rollups

`usage_daily_rollups`

- `id`
- `organization_id`
- `rollup_date`
- `scope_type` (`platform | user | department | model | feature`)
- `scope_id`
- `model`
- `feature_type`
- `request_count`
- `success_count`
- `failure_count`
- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `estimated_cost`
- `internal_cost`
- `created_at`
- `updated_at`

Rules:

- `scope_type=platform` uses a fixed platform scope id
- `scope_type=user` stores the user id in `scope_id`
- `scope_type=department` stores the department id in `scope_id`
- `scope_type=model` stores the model key in `scope_id`
- `scope_type=feature` stores the feature type in `scope_id`

### Cost profiles

`cost_profiles`

- `id`
- `organization_id`
- `model`
- `input_token_price`
- `cached_input_token_price`
- `output_token_price`
- `internal_cost_multiplier`
- `is_active`
- `created_at`
- `updated_at`

Purpose:

- raw model pricing
- internal accounting adjustment

### Quota policies

`quota_policies`

- `id`
- `organization_id`
- `scope_type` (`platform | department`)
- `scope_id`
- `feature_type`
- `model`
- `metric_type` (`request_count | total_tokens | estimated_cost | internal_cost`)
- `window_type` (`daily`)
- `threshold_value`
- `enforcement_mode` (`alert_only | soft_block`)
- `is_active`
- `created_at`
- `updated_at`

Rules:

- platform rules use a fixed platform scope id
- department rules override platform rules when both apply to the same dimension
- this phase supports only daily windows

### Alert rules

`alert_rules`

- `id`
- `organization_id`
- `scope_type` (`platform | department`)
- `scope_id`
- `rule_type` (`quota_threshold | error_rate | security_event`)
- `name`
- `description`
- `conditions` (JSON)
- `channels` (JSON)
- `is_active`
- `created_at`
- `updated_at`

Examples:

- daily internal cost for department exceeds threshold
- sync failure rate exceeds threshold
- repeated denied resource access exceeds threshold

### Alert events

`alert_events`

- `id`
- `organization_id`
- `alert_rule_id`
- `scope_type`
- `scope_id`
- `severity` (`info | warning | critical`)
- `status` (`open | acknowledged | resolved`)
- `title`
- `detail`
- `payload`
- `created_at`
- `updated_at`

### Notification records

`notification_records`

- `id`
- `organization_id`
- `channel_type` (`in_app | dingtalk`)
- `target_ref`
- `event_type`
- `status` (`pending | sent | failed`)
- `payload`
- `error_message`
- `created_at`
- `updated_at`

Purpose:

- durable record of alert delivery attempts
- operational debugging for DingTalk notification failures

## Event Sources

The first-phase event producers should include:

- session creation
- thread execution completion
- runtime usage completion
- workspace mount
- knowledge-set mount
- managed upload or download
- access denial from resource policy evaluation
- permission denial from `requirePermission(...)`
- organization sync runs
- selected admin actions with operational cost or risk implications

## Services

### `ResourceAccessLogService`

Responsibilities:

- write `resource_access_logs`
- normalize resource action metadata
- accept session and thread context when available

### `UsageIngestionService`

Responsibilities:

- write `usage_events`
- calculate estimated and internal cost using active `cost_profiles`
- normalize model and feature dimensions

### `UsageRollupService`

Responsibilities:

- aggregate raw usage events into daily rollups
- support repeated idempotent recomputation for the same day

### `QuotaEvaluationService`

Responsibilities:

- resolve applicable platform or department quota rule
- evaluate recent usage against the selected metric
- return allow / soft-block decision

### `AlertEvaluationService`

Responsibilities:

- evaluate quota, reliability, and security conditions
- emit `alert_events`
- request downstream notification delivery

### `NotificationDispatchService`

Responsibilities:

- write `notification_records`
- deliver in-app notifications
- deliver DingTalk notifications

## Admin Console Modules

### Monitoring Overview

Displays:

- total requests
- total tokens
- estimated cost
- internal cost
- failure rate
- alert count
- recent trends

### Rankings

Displays:

- top users by usage
- top departments by usage
- top models by cost
- top feature dimensions by cost

### Resource Access Logs

Displays:

- who accessed what
- action type
- result status
- session / thread context
- recent denied or failed attempts

### Quota Rules

Displays:

- platform default rules
- department overrides
- current enforcement mode

### Alert Center

Displays:

- active alert events
- severity
- scope
- channel delivery status

### Cost Configuration

Displays:

- model pricing
- internal multipliers
- active or inactive status

## API Shape

The backend should expose three management surfaces:

- monitoring reads
- policy and cost configuration
- alert operations

Recommended endpoints:

- `GET /api/admin/monitoring/overview`
- `GET /api/admin/monitoring/rankings`
- `GET /api/admin/monitoring/trends`
- `GET /api/admin/monitoring/resource-access-logs`
- `GET /api/admin/monitoring/usage-events`
- `GET /api/admin/quota-policies`
- `POST /api/admin/quota-policies`
- `PATCH /api/admin/quota-policies/:policyId`
- `GET /api/admin/cost-profiles`
- `POST /api/admin/cost-profiles`
- `PATCH /api/admin/cost-profiles/:profileId`
- `GET /api/admin/alert-rules`
- `POST /api/admin/alert-rules`
- `PATCH /api/admin/alert-rules/:ruleId`
- `GET /api/admin/alert-events`
- `POST /api/admin/alert-events/:eventId/acknowledge`
- `GET /api/admin/notification-records`

## Integration With Existing Subsystems

### RBAC

Existing `admin_audit_logs` remain in place for management-change auditing.

This phase adds operational logging rather than replacing RBAC audit history.

### Portal runtime

The existing portal usage snapshot parsing becomes an input for `usage_events`.

### Workspace and knowledge-set management

Existing resource mounting and upload flows become primary producers of `resource_access_logs`.

### DingTalk

Existing DingTalk identity and org-sync infrastructure are reused for alert delivery and department scoping.

## Error Handling

- event ingestion failures must not silently corrupt user-facing flows
- if monitoring write fails for a non-critical path, log and continue with bounded failure reporting
- quota evaluation failures should fail open only for explicitly configured low-risk paths; session creation and costly operations should default to conservative behavior when evaluation data is present but inconsistent
- notification delivery failure must not roll back the underlying alert event

## Testing Strategy

The implementation must include:

- repository tests for new event, quota, alert, and cost tables
- service tests for:
  - usage ingestion
  - rollup generation
  - quota evaluation
  - alert evaluation
  - notification dispatch
- route tests for monitoring, quota, and alert admin APIs
- frontend tests for monitoring views, quota-rule management, and alert center flows
- compatibility tests proving:
  - new quota checks do not terminate already-running sessions
  - department override rules take precedence over platform defaults
  - denied resource access produces both access logs and security-alert evaluation input

## Implementation Order

Recommended implementation order:

1. schema and persistence for events, rollups, quota rules, alert rules, and notification records
2. usage and resource access ingestion services
3. rollup and quota evaluation services
4. alert evaluation and notification dispatch
5. admin monitoring, quota, and alert APIs
6. admin-console monitoring and configuration pages
7. end-to-end verification

## Success Criteria

This phase is complete when:

- platform operators can inspect usage and cost by platform, user, department, model, and feature
- protected resource access is durably logged with session and thread context
- platform and department quota rules can be managed from the admin console
- new sessions and new costly actions soft-block when quota rules require it
- alert rules can trigger alert events and DingTalk notifications
- the admin console exposes monitoring, quota, and alert management views
