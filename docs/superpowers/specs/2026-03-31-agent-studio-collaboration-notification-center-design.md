# Agent Studio Collaboration and Notification Center Design

## Goal

Build a first-version collaboration and notification layer on top of existing threads, notifications, and DingTalk delivery so internal employees can safely share conversation context, discuss work in-thread, assign ownership, and receive actionable updates in a unified inbox.

## Scope

### In scope
- Thread sharing
  - share to specific users
  - share to specific departments
  - revoke existing shares
- Thread comments
  - plain comments
  - `@user` mentions
- Thread assignment
  - single owner
  - follower list
- Inbox
  - collaboration events
  - monitoring/alert events
  - system broadcasts
  - mark read / unread
  - archive / unarchive
- DingTalk delivery for supported inbox events
- System broadcasts
  - broadcast creation and publishing by authorized admins
- Knowledge capture markers
  - mark a thread as `pending_capture`
  - clear the pending-capture mark
- Shared thread viewer permissions
  - read message history
  - read attachment list
  - read runtime configuration snapshot
  - comment on shared threads
  - no permission to continue message generation in the shared thread
- Attachment access policy for shared threads
  - sharing does not widen download permissions
  - downloads still require original attachment/resource access checks
- Audit and notification integration
  - write collaboration actions to admin/user audit surfaces as appropriate
  - create inbox items for collaboration events
  - optionally fan out to DingTalk delivery

### Out of scope
- public sharing to the whole company
- external-user sharing
- department mentions in comments
- multiple owners on a thread
- editing or deleting historical messages
- continuing agent generation in a shared thread by non-owner viewers
- formal knowledge base write-back
- approval workflow integration
- email notifications
- threaded comment replies in v1
- message-level partial sharing in v1

## Design principles

1. Preserve thread ownership while allowing controlled collaboration.
- The thread owner remains the runtime owner.
- Sharing grants read/comment collaboration rights, not execution ownership.

2. Keep resource boundaries explicit.
- Shared threads expose message content, attachment metadata, and runtime snapshots.
- Attachments and other files still require original permission checks before download.

3. Reuse existing platform primitives where possible.
- Use existing thread persistence, RBAC, resource policies, notification records, and DingTalk notification infrastructure.
- Add product-layer collaboration models instead of reimplementing alerts or messaging from scratch.

4. Separate collaboration events from operational alerts while unifying inbox consumption.
- Collaboration events, alerts, and broadcasts enter the same inbox surface.
- Their generation and permission models remain distinct.

5. Keep first-version collaboration intentionally narrow.
- One owner, optional followers, flat comments, user mentions only.
- Mark knowledge capture candidates without attempting full knowledge publication.

## Core user stories

1. A thread owner shares a conversation with another employee or department so they can review the outcome and discuss next steps.
2. A reviewer comments on the shared thread and mentions a teammate, which creates inbox items and DingTalk notifications for the mentioned user.
3. An owner assigns the thread to a single responsible user and adds followers to keep stakeholders informed.
4. An employee sees collaboration updates, monitoring alerts, and platform broadcasts in a unified inbox and can mark items read or archive them.
5. An operator marks a useful thread as `pending_capture` so later knowledge curation work can process it.

## Core model

### Thread shares
Create `thread_shares` as the explicit collaboration access model.

Recommended fields:
- `id`
- `thread_id`
- `subject_type` (`user` | `department`)
- `subject_id`
- `permission_level` (`read_comment`)
- `shared_by_user_id`
- `created_at`
- `revoked_at`
- `revoked_by_user_id`

Rules:
- Shares are additive.
- A user can access a shared thread if:
  - they are the owner, or
  - they are directly shared, or
  - they belong to a shared department.
- Revoking a share only affects that share record.
- Effective permissions for v1 are always `read_comment`.

### Thread comments
Create `thread_comments` for collaboration notes attached to a thread.

Recommended fields:
- `id`
- `thread_id`
- `author_user_id`
- `body_markdown`
- `mentioned_user_ids` (JSON array or join table)
- `created_at`
- `updated_at`

Rules:
- Comments are flat, newest-last.
- Comments are allowed for:
  - thread owner
  - users with effective shared-thread access
  - admins with explicit collaboration read/write rights
- Mentions only support user targets in v1.

### Thread assignment
Create `thread_assignments` and `thread_followers`.

Recommended fields:
- `thread_assignments`
  - `thread_id`
  - `owner_user_id`
  - `assigned_by_user_id`
  - `assigned_at`
- `thread_followers`
  - `id`
  - `thread_id`
  - `user_id`
  - `added_by_user_id`
  - `created_at`

Rules:
- At most one active owner per thread.
- Follower list may have zero or more users.
- Assignment changes generate inbox events and optional DingTalk notifications.

### Inbox
Create `inbox_items` as the user-facing unified inbox.

Recommended fields:
- `id`
- `user_id`
- `event_type`
- `category` (`collaboration` | `alert` | `broadcast`)
- `title`
- `body`
- `status` (`unread` | `read` | `archived`)
- `thread_id`
- `related_entity_type`
- `related_entity_id`
- `source_actor_user_id`
- `payload` (JSON)
- `created_at`
- `read_at`
- `archived_at`

Rules:
- One inbox item belongs to one recipient user.
- System broadcasts materialize one inbox item per recipient.
- Alert events may continue using existing notification records for delivery history; inbox items are the user-facing feed.

### Broadcasts
Create `broadcast_messages` and `broadcast_targets`.

Recommended fields:
- `broadcast_messages`
  - `id`
  - `title`
  - `body_markdown`
  - `status` (`draft` | `published` | `archived`)
  - `created_by_user_id`
  - `published_at`
  - `published_by_user_id`
- `broadcast_targets`
  - `id`
  - `broadcast_id`
  - `target_type` (`all_users` | `department` | `role`)
  - `target_id`

Rules:
- Sending broadcasts requires a dedicated permission, not implicit admin status.
- Publishing a broadcast fans out inbox items to resolved target users.
- DingTalk delivery is optional per broadcast and recorded in notification delivery history.

### Knowledge capture markers
Create `knowledge_capture_marks`.

Recommended fields:
- `thread_id`
- `status` (`pending_capture`)
- `marked_by_user_id`
- `marked_at`
- `note`

Rules:
- At most one active pending-capture mark per thread.
- This is a workflow marker only; it does not write into knowledge sets.

## Access model

### Shared thread access
A user may open a collaboration view of a thread if any of the following is true:
- they own the thread
- they have an active direct share
- they belong to a department with an active share
- they have elevated admin permission for collaboration audit/read

Shared viewers can:
- view thread metadata
- view message history
- view attachment list
- view runtime snapshot
- add comments

Shared viewers cannot:
- modify thread runtime settings
- upload new attachments to the thread by virtue of sharing alone
- continue the conversation generation stream in the shared thread
- delete the thread

### Attachment access
Sharing a thread does not widen attachment/file access.

Rules:
- The shared viewer can always see attachment metadata included in the thread view.
- Actual download still checks the original attachment/resource access policy.
- If access is denied, the UI should show the file in the list but deny download with a clear message.

### Collaboration permissions
Add collaboration-specific functional permissions, for example:
- `collaboration.read`
- `collaboration.share`
- `collaboration.comment`
- `collaboration.assign`
- `collaboration.broadcast.publish`
- `collaboration.capture_mark.write`
- `inbox.read`
- `inbox.write`

Resource instance scoping should continue using existing `resource_policies` where relevant for concrete resources. Collaboration access to a thread is governed by ownership and `thread_shares`, not by generic resource policy rows.

## Event model

### Collaboration event types
Recommended event types:
- `thread.shared`
- `thread.share_revoked`
- `thread.comment_added`
- `thread.mentioned`
- `thread.assigned`
- `thread.follower_added`
- `thread.capture_marked`
- `broadcast.published`

### Inbox generation rules
- Share creation:
  - generate inbox items for newly shared users
  - direct department shares fan out to department members at generation time
- Comment creation:
  - generate inbox items for owner, followers, and mentioned users except the author
- Assignment change:
  - generate inbox item for assignee and followers
- Broadcast publish:
  - generate inbox item per resolved recipient
- Alert events:
  - continue existing alert pipeline, then project relevant user-facing items into inbox

### DingTalk delivery
DingTalk is the only non-inbox delivery channel in v1.

Suggested delivery policy:
- mentions: deliver to mentioned users
- assignments: deliver to assignee
- broadcasts: configurable per broadcast, default off for low-priority messages
- alerts: continue existing alert delivery rules

Delivery outcomes should continue being recorded through existing notification record infrastructure, linked back to inbox items or broadcast ids where useful.

## UI surfaces

### Portal collaboration drawer / panel
Add collaboration affordances to the thread experience without turning shared threads into editable runtime sessions.

Suggested capabilities:
- open collaboration panel for current thread
- share thread to user/department
- view current share targets
- comments stream
- assignment block (owner + followers)
- mark as pending capture

For shared viewers:
- collaboration panel remains available
- runtime composer remains disabled for message generation in that shared thread context

### Inbox center
Add a dedicated user-facing inbox surface.

Suggested sections:
- `全部`
- `协作`
- `告警`
- `广播`

Supported actions:
- mark read / unread
- archive / unarchive
- navigate to related thread or entity

### Admin broadcast management
Add a small admin/operator surface for broadcasts.

Suggested capabilities:
- create draft broadcast
- choose targets
- publish broadcast
- view publish history and delivery summary

## API surface

Recommended endpoints:

### Thread collaboration
- `GET /api/threads/:threadId/collaboration`
- `PUT /api/threads/:threadId/shares`
- `POST /api/threads/:threadId/comments`
- `GET /api/threads/:threadId/comments`
- `PUT /api/threads/:threadId/assignment`
- `PUT /api/threads/:threadId/followers`
- `PUT /api/threads/:threadId/capture-mark`

### Inbox
- `GET /api/inbox`
- `POST /api/inbox/:itemId/read`
- `POST /api/inbox/:itemId/unread`
- `POST /api/inbox/:itemId/archive`
- `POST /api/inbox/:itemId/unarchive`

### Broadcasts
- `GET /api/admin/broadcasts`
- `POST /api/admin/broadcasts`
- `PATCH /api/admin/broadcasts/:broadcastId`
- `POST /api/admin/broadcasts/:broadcastId/publish`

## Integration points

### Thread repository and portal UI
- reuse existing thread ownership and thread metadata
- extend thread reads so authorized shared viewers can read collaboration-safe thread snapshots
- do not change ownership semantics for runtime session creation

### Notification pipeline
- reuse notification dispatch and DingTalk sender
- add inbox projection layer so user-facing notifications become first-class inbox items

### Monitoring / alerts
- keep operational alerts as their own producers
- project eligible alert records into inbox items
- avoid duplicating alert evaluation logic inside collaboration services

### RBAC
- use new collaboration permissions for functional access
- use existing user/department models from org sync for share targeting and broadcast target resolution

## Audit

Audit at minimum:
- thread share create / revoke
- comment create
- assignment update
- follower update
- capture mark create / clear
- broadcast create / publish
- inbox bulk-status operations if implemented later

Suggested action keys:
- `collaboration.share.update`
- `collaboration.comment.create`
- `collaboration.assignment.update`
- `collaboration.capture_mark.update`
- `broadcast.create`
- `broadcast.publish`

## Validation rules

Examples:
- cannot share a thread to a nonexistent user or department
- cannot assign a nonexistent or inactive user
- cannot mention a nonexistent or inactive user
- comment body must be non-empty and below a sane length cap
- cannot create duplicate active follower rows for the same user/thread pair
- cannot create duplicate active pending-capture marks
- only users with access to the thread can comment on it
- broadcasts must have at least one target before publish

## Non-goals for v1

Do not include:
- nested comment threads
- emoji reactions
- company-wide public share links
- cross-organization sharing
- knowledge article generation
- approval workflow routing
- external email delivery
