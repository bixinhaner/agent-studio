# Agent Studio System Settings Center Design

## Goal

Build a unified admin-facing System Settings Center for platform-level defaults and hard safety limits, with draft/published release semantics. The first version must manage only settings that are operationally safe to change from the admin UI and must not move deployment-only filesystem/path configuration into the database.

## Scope

### In scope
- Brand and presentation settings
  - platform name
  - admin/header subtitle
  - login page copy
  - logo URL
  - icon URL
- Platform default model entry
  - default provider
  - default model
  - default reasoning effort
- Retention defaults
  - session retention days
  - attachment retention days
  - alert retention days
- Upload limits
  - max single file size
  - max total upload size per request
- Global safety policy
  - platform hard limits / hard disables that run profiles cannot exceed
- Organization defaults
  - default DingTalk org-sync interval
- Platform default behavior copy
  - structured summary fields
  - Markdown long-form behavior guidance
- Draft vs published settings lifecycle
  - save draft
  - publish explicitly
  - new requests / new sessions read published version only
  - running sessions keep the snapshot they started with
- Publish history metadata
  - published at
  - published by
  - current draft version metadata

### Out of scope
The following remain env-only / deployment-only in v1:
- `workspaceWhitelist`
- `uploadTempRoot`
- `knowledgeSetStorageRoot`
- `defaultWorkspace`
- any mutable filesystem path roots
- secret/provider credential editing
- integration connectivity validation

## Design principles

1. Separate platform defaults from integration operations.
- Integration Center manages providers, credentials, connectivity, and rotation.
- System Settings Center manages platform defaults and hard guardrails.

2. Separate hard limits from scenario defaults.
- System settings define platform-wide hard boundaries.
- Run profiles and agent modes may narrow within those boundaries but must not exceed them.

3. Do not mutate runtime behavior for already-running sessions.
- Published settings affect new requests and new sessions only.
- Existing sessions retain their captured runtime snapshot.

4. Keep deployment-risk configuration out of the admin UI.
- Filesystem/path/storage-root settings remain environment-managed in v1.

## Core model

Introduce a versioned system settings record with two logical states:
- `draft`
- `published`

Recommended persistence shape:
- `system_settings_versions`
  - `id`
  - `version_number`
  - `status` (`draft` | `published`)
  - `payload` (JSON)
  - `created_at`
  - `updated_at`
  - `published_at`
  - `published_by_user_id`

Optional derived table if needed for easier reads:
- `system_settings_current`
  - `draft_version_id`
  - `published_version_id`

## Payload shape

```json
{
  "branding": {
    "platformName": "Agent Studio",
    "headerSubtitle": "Enterprise Agent Platform",
    "loginCopy": "Sign in with DingTalk to continue.",
    "logoUrl": "https://...",
    "iconUrl": "https://..."
  },
  "platformDefaults": {
    "provider": "openai_codex",
    "model": "gpt-5.4",
    "reasoningEffort": "high"
  },
  "retention": {
    "sessionDays": 30,
    "attachmentDays": 30,
    "alertDays": 14
  },
  "uploads": {
    "maxSingleFileBytes": 10485760,
    "maxTotalUploadBytes": 52428800
  },
  "safety": {
    "allowDangerFullAccess": false,
    "allowNetworkAccess": true,
    "allowLiveWebSearch": true,
    "allowCustomAdditionalDirectories": false,
    "allowFilesystemMutations": true
  },
  "organizationDefaults": {
    "orgSyncIntervalMinutes": 1440
  },
  "behavior": {
    "welcomeSummary": "Use approved resources and modes only.",
    "usageSummary": "New sessions use published platform defaults.",
    "markdown": "## Platform Behavior\n\nDetailed explanation..."
  }
}
```

## Hard-limit behavior

System settings must define platform-wide hard safety bounds.

Examples:
- if `allowDangerFullAccess=false`, no run profile may enable `danger-full-access`
- if `allowNetworkAccess=false`, no run profile may enable outbound network
- if `allowLiveWebSearch=false`, no run profile may set web search to `live`
- if `allowCustomAdditionalDirectories=false`, user-facing flows must not allow custom additional directory selection

This means:
- System Settings Center is authoritative for hard boundaries.
- Capability Center and portal runtime selection logic must respect those boundaries.

## Publishing model

### Draft
- Admin edits write into the current draft version.
- Draft changes are not used by runtime resolution yet.

### Publish
- Admin explicitly publishes the current draft.
- Publish operation records:
  - `published_at`
  - `published_by_user_id`
- Published version becomes the new source of truth for:
  - new admin reads that request the active settings
  - new portal requests
  - new session creation

### Running sessions
- Running sessions remain unchanged.
- No live mutation of existing session runtime state.

## Admin UI

Add a new admin section: `系统设置`

### Layout
Use the same shell conventions already used by Resource Center, Capability Center, and Integration Center.

Sections/tabs in v1:
- `基本设置`
  - branding
  - behavior summary + markdown
- `模型默认值`
  - provider / model / reasoning
- `保留与上传`
  - retention
  - upload limits
- `安全策略`
  - hard limits
- `组织默认值`
  - org sync interval
- `发布记录`
  - current draft metadata
  - current published metadata
  - publish action

### UX behavior
- show whether the admin is editing draft or viewing published state
- support `保存草稿`
- support `发布设置`
- show last published at / by
- show validation errors inline

## API surface

Recommended endpoints:
- `GET /api/admin/system-settings`
  - returns `{ draft, published, draftMeta, publishedMeta }`
- `PUT /api/admin/system-settings/draft`
  - updates draft payload
- `POST /api/admin/system-settings/publish`
  - publishes current draft and returns new active state
- optional:
  - `POST /api/admin/system-settings/reset-draft`

## Validation rules

Examples:
- `platformName` non-empty
- `provider` must reference an allowed provider key
- `model` must be non-empty
- `reasoningEffort` must be valid for the chosen model
- retention values must be bounded positive integers
- upload sizes must be positive integers and `maxTotalUploadBytes >= maxSingleFileBytes`
- org sync interval must be a positive integer within a sane operational range
- logo/icon URLs must be valid URLs or empty

## Integration points

### Portal / runtime
- new requests read the published system settings
- runtime option resolution should clamp values against platform safety settings

### Capability Center
- run profiles must validate against the published hard limits
- UI should reflect when a platform hard limit disables an option

### Integration Center
- provider instances stay in Integration Center
- System Settings Center references provider keys / defaults only

### Org Sync
- default interval comes from published system settings
- org-sync runtime continues to own immediate execution and job status

## Audit

Publishing and draft updates should write admin audit logs.

At minimum record:
- action type (`system_settings.update_draft`, `system_settings.publish`)
- actor user id
- version id
- summary metadata

## Initial non-goals

Do not include in v1:
- dynamic path root editing
- full theme system
- secret management
- provider credential editing
- provider validation from the settings page
- user-level or department-level override settings
- auto-scheduled publish windows

## Success criteria

The feature is complete when:
- admins can edit draft platform settings safely from the UI
- admins can publish settings explicitly
- new requests/sessions use published settings
- running sessions remain unchanged
- run profiles cannot exceed published hard limits
- deployment-only path settings remain outside the UI
