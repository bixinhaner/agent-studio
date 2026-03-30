# Agent Studio Integration Center Design

Date: 2026-03-30
Branch: `codex/cloud-foundation`
Status: Draft for review

## 1. Summary

This sub-project adds a unified admin-facing Integration Center for Agent Studio.

The current codebase already contains integration capabilities, but they are fragmented:
- `Zendesk` has a dedicated service, persistence-backed settings, and a standalone panel.
- `DingTalk` exists across login, org sync, and notification wiring, but does not have a dedicated admin integration console.
- `OpenAI/Codex` is still primarily configured through environment variables and runtime defaults instead of an admin-facing integration model.

The goal of this sub-project is to move these into one consistent operational surface:
- one admin entry
- one integration instance model
- one permission and policy model
- one validation and secret-rotation workflow
- one UI structure that matches the existing Resource Center and Capability Center

Initial scope is intentionally limited to:
- `dingtalk`
- `zendesk`
- `openai_codex`

Out of scope for this phase:
- Git integrations
- object storage integrations
- generic webhook integrations
- plugin-style integration registry
- approval workflows
- system settings center

## 2. Why This Is Needed

The current implementation is already powerful enough to justify an Integration Center, but the operational experience is inconsistent:

- `Zendesk` is configured through a standalone endpoint and panel.
- `DingTalk` configuration is partially environment-backed and partially implicit in other modules.
- `OpenAI/Codex` is treated as runtime infrastructure, not as a managed platform integration.
- `integration.read` and `integration.write` permissions already exist in RBAC, but there is no first-class admin product area that uses them.

As a result:
- configuration ownership is unclear
- secret handling is inconsistent
- validation history is not unified
- multiple integration concerns are scattered across different modules

This project closes that gap.

## 3. Goals

This phase must deliver:
- a unified Integration Center entry in the admin console
- a unified `integration instance` persistence model
- first-class management for `DingTalk`, `Zendesk`, and `OpenAI-Codex`
- configuration editing for each supported integration type
- connection validation / test actions for each supported integration type
- secret rotation and secret-state clearing workflows
- validation and rotation history visibility
- integration-level RBAC + resource-policy protection
- migration of Zendesk editing from the standalone panel into the Integration Center

## 4. Non-Goals

This phase does not include:
- system-wide defaults unrelated to specific integrations
- approval flow configuration
- multi-version secret vaulting or rollback
- plugin registration or user-installable integrations
- tenant-aware external customer isolation
- general webhook orchestration beyond existing Zendesk webhook use
- changing the existing runtime abstraction from `CodexRuntime` to a more generic provider layer

## 5. Current State

### 5.1 Zendesk

Current implementation already includes:
- persistence-backed settings
- service-level overview and validation logic
- manual run support
- webhook handling
- standalone frontend panel

Relevant files:
- `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/zendesk/service.ts`
- `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/integrations/zendesk/router.ts`
- `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/persistence/integration-repository.ts`
- `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/features/zendesk/ZendeskIntegrationPanel.tsx`

### 5.2 DingTalk

Current implementation already includes:
- login/OAuth configuration usage
- session creation
- org sync provider integration
- alert notification delivery

But there is no admin-facing integration configuration screen.

Relevant files:
- `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/auth/dingtalk.ts`
- `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/admin/org-sync-router.ts`
- `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/index.ts`

### 5.3 OpenAI/Codex

Current implementation already includes:
- runtime usage through `CodexRuntime`
- model defaulting through `config.ts`
- monitoring and quota usage grouped by model

But there is no admin-facing integration model or validation flow for provider credentials.

Relevant files:
- `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/codex-runtime.ts`
- `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/config.ts`

## 6. Product Shape

A new admin module is added: `集成中心`.

It follows the same interaction model as the existing centers:
- Resource Center
- Capability Center

### 6.1 Navigation

Admin top-level navigation adds:
- `集成中心`

### 6.2 Layout

The Integration Center uses a unified split layout:

Left side:
- integration type switcher
- list of instances for the selected type
- search and status filtering

Right side:
- detail editor for the selected instance
- tabbed sections:
  - `基本信息`
  - `配置`
  - `验证与历史`
  - `绑定关系`
  - `授权`

## 7. Integration Instance Model

This phase introduces a unified `integration instance` model.

### 7.1 Supported Types

Initial built-in types:
- `dingtalk`
- `zendesk`
- `openai_codex`

### 7.2 Instance Count Rules

First-phase quantity rules are intentionally constrained:
- `dingtalk`: single instance
- `openai_codex`: single instance
- `zendesk`: multi-instance

This matches current platform realities:
- DingTalk is a single enterprise identity and notification source.
- OpenAI/Codex is a platform-level model provider.
- Zendesk may legitimately need multiple active business/system instances.

### 7.3 Lifecycle

Every integration instance supports:
- create
- edit
- activate
- disable

This phase does not support physical deletion.

### 7.4 Status Model

Each integration instance must expose operational state such as:
- `draft`
- `active`
- `disabled`
- `error`

The exact stored enum can be simplified during implementation if needed, but the UI must distinguish:
- configured but not ready
- active and usable
- disabled by admin
- failing validation or runtime checks

## 8. Data Model

A unified instance model should be introduced on top of the existing persistence layer.

Recommended shape:

### 8.1 `integration_instances`

Fields:
- `id`
- `organization_id`
- `type`
- `slug`
- `name`
- `description`
- `status`
- `is_system_singleton`
- `created_at`
- `updated_at`

### 8.2 `integration_instance_configs`

Stores non-secret configuration payloads.

Fields:
- `id`
- `integration_instance_id`
- `config`
- `created_at`
- `updated_at`

### 8.3 `integration_instance_secrets`

Stores current secret-bearing payload only.

Fields:
- `id`
- `integration_instance_id`
- `secret_state`
- `rotated_at`
- `rotated_by_user_id`
- `updated_at`

Important design choice:
- this phase stores only the current effective secret state
- it does not implement historical secret version rollback

### 8.4 `integration_validation_runs`

Stores validation/test history.

Fields:
- `id`
- `integration_instance_id`
- `trigger_type` (`manual` / `automatic`)
- `status` (`success` / `failed`)
- `summary`
- `detail`
- `triggered_by_user_id`
- `created_at`

### 8.5 `integration_binding_records`

Stores binding relationships between an integration instance and platform resources.

First-phase examples:
- Zendesk instance bound to specific agent modes
- Zendesk instance bound to specific workspaces or knowledge-backed flows
- OpenAI/Codex provider defaults exposed to runtime profile defaults

Not every integration type must use every binding target in phase one, but the model should not hard-code Zendesk-only semantics.

## 9. Type-Specific Design

## 9.1 DingTalk

The DingTalk instance page covers:
- login / OAuth configuration
- org sync configuration
- notification configuration

### Basic Info
- instance name
- description
- status

### Config
- client id
- client secret
- redirect URI
- OAuth scope
- alert agent id
- alert user ids
- org sync enabled flag
- org sync interval minutes

### Validation / History
- validate OAuth/client credential configuration
- optionally perform a lightweight app token fetch or equivalent supported check
- show recent validation history
- show last rotation metadata

### Binding Relations
DingTalk is mostly platform-wide in phase one, so this tab is minimal.
It may show:
- platform identity source enabled
- org sync enabled
- notification delivery enabled

### Authorization
Managed through the common resource policy editor.

## 9.2 Zendesk

The Zendesk instance page subsumes the existing standalone panel.

### Basic Info
- instance name
- slug
- description
- status

### Config
This phase migrates the currently editable settings into the Integration Center, including:
- enabled
- public base URL
- Zendesk base URL
- Zendesk email
- API token
- webhook signing secret
- response mode
- fallback mode
- auto status
- excluded tags
- workspace
- model
- reasoning effort
- sandbox mode
- approval policy
- network access
- web search mode
- additional directories
- max comment history
- system prompt

### Validation / History
- validate connection
- show missing readiness fields
- show webhook URL/setup hint
- show manual test run history
- show validation history
- show secret rotation metadata

### Binding Relations
Because Zendesk supports multiple active instances in phase one, bindings matter.
This tab should allow the platform to express which resources or modes use which Zendesk instance.

At minimum the model must support binding Zendesk instances to:
- agent modes
- optionally workspaces or other future targets

The implementation may keep the first visual version narrow, but the data model must not assume a single global Zendesk instance.

### Authorization
Managed through common resource policy editing.

### Migration Rule
The existing standalone Zendesk editing entry is removed as the primary admin path.
The Integration Center becomes the canonical edit surface.

## 9.3 OpenAI/Codex

This page manages the model provider integration used by the current runtime.

### Basic Info
- instance name
- description
- status

### Config
- provider label
- base URL if supported by runtime/provider configuration
- API key / secret state
- default model
- default reasoning effort

### Validation / History
- validate provider connectivity using a lightweight capability check
- show last successful validation
- show validation history
- show secret rotation metadata

### Binding Relations
This phase focuses on platform-level default bindings, not per-tenant provider routing.
This tab may show:
- which default run profiles or platform defaults consume this provider
- whether it is the active default provider

### Authorization
Managed through common resource policy editing.

### Important Boundary
This does not replace run-profile-level runtime strategy.
It only centralizes provider connectivity and platform default model entry.

## 10. Secret Rotation Model

First-phase secret handling must support:
- replacing current secret values
- clearing current secret-state indicators
- recording:
  - `rotated_at`
  - `rotated_by_user_id`

It must not support:
- storing multiple secret generations for rollback
- showing old secrets
- exporting secret history

The UI behavior should match current secure-edit patterns:
- existing secrets are represented as “already saved” state
- empty input does not overwrite unless the user explicitly clears
- clear and rotate actions are explicit

## 11. Validation and History

Every supported integration type must support manual validation/testing.

Phase-one minimum expectations:
- `DingTalk`: credential/app validation check
- `Zendesk`: existing connection validation and manual test support
- `OpenAI/Codex`: provider connectivity validation

Validation history should include:
- when validation ran
- who triggered it
- whether it succeeded
- a compact summary
- expandable detail

This history is operational, not audit-replacement.
Admin audit logs continue to record configuration changes separately.

## 12. Binding Model

The Integration Center must support a `绑定关系` tab for every integration type.

The purpose is not to force every integration into identical bindings, but to provide a consistent place where the platform answers:
- what uses this integration?
- where is this integration active?

### Phase-One Binding Expectations
- `DingTalk`: mostly informational platform bindings
- `Zendesk`: concrete resource/mode bindings
- `OpenAI/Codex`: platform default/provider bindings

### Zendesk Multi-Instance Rule
Multiple Zendesk instances may be `active` at the same time.
The platform does not enforce one global default active Zendesk instance.
Selection is determined by binding relationships and later runtime resolution.

## 13. Authorization Model

### 13.1 Functional Permissions
Use existing RBAC permission keys:
- `integration.read`
- `integration.write`

### 13.2 Resource Scope
Use existing `resource_policies` to control access to specific integration instances.

This keeps the same separation used elsewhere in the platform:
- RBAC answers: can this admin operate in the Integration Center?
- resource policy answers: which specific integration instances can they view or edit?

This phase must not create a parallel authorization model just for integrations.

## 14. Backend Architecture

## 14.1 Router Structure
Add an admin-facing integration-center router under `/api/admin`.

Recommended route family:
- `GET /api/admin/integrations`
- `POST /api/admin/integrations`
- `GET /api/admin/integrations/:id`
- `PATCH /api/admin/integrations/:id`
- `POST /api/admin/integrations/:id/validate`
- `GET /api/admin/integrations/:id/history`
- `PUT /api/admin/integrations/:id/bindings`
- `GET /api/admin/integrations/:id/policies`
- `PUT /api/admin/integrations/:id/policies`

Type-specific convenience routes are acceptable internally, but the admin surface should be unified.

## 14.2 Service Structure
Recommended services:
- `IntegrationInstanceRepository`
- `IntegrationValidationRepository`
- `IntegrationBindingRepository`
- `IntegrationCenterService`
- type-specific handlers/adapters:
  - `DingTalkIntegrationAdapter`
  - `ZendeskIntegrationAdapter`
  - `OpenAICodexIntegrationAdapter`

This keeps type-specific configuration and validation logic isolated while preserving one admin contract.

## 14.3 Migration Approach
Zendesk is the main migration case.

Migration rule:
- do not break existing runtime behavior
- move Zendesk admin editing into the Integration Center
- preserve current settings semantics and secure-edit behavior
- keep compatibility with existing persistence during transition if needed

## 15. Frontend Architecture

## 15.1 New Module
Add a new admin feature module:
- `agent-ui/src/features/integration-center/`

Recommended components:
- `IntegrationCenterShell`
- `IntegrationList`
- `IntegrationDetail`
- `DingTalkIntegrationView`
- `ZendeskIntegrationView`
- `OpenAICodexIntegrationView`
- `IntegrationPolicyEditor`
- `IntegrationBindingsEditor`
- `IntegrationValidationHistory`

## 15.2 Interaction Model
The shell should align with Resource Center and Capability Center patterns:
- left-side filtered list
- right-side detail editor
- tabbed detail sections
- optimistic but safe edit flows

## 15.3 Zendesk UI Migration
The standalone `ZendeskIntegrationPanel` is no longer the main admin entry.
Its functionality is migrated into the unified integration-center view.
The old entry should be removed from normal admin flows.

## 16. Data Flow

### 16.1 Read Path
- admin enters Integration Center
- frontend loads integration instance list by type
- selecting an instance loads:
  - config summary
  - validation history
  - bindings
  - resource policies

### 16.2 Write Path
- admin edits config or rotates secret
- backend updates the active config/secret state
- backend writes admin audit record
- backend may optionally trigger post-save validation
- frontend refreshes instance detail

### 16.3 Validation Path
- admin clicks validate/test
- backend runs type-specific validation
- result stored to validation history
- frontend refreshes current detail and history

## 17. Error Handling

The Integration Center must return controlled, integration-specific errors:
- invalid credentials
- unsupported single-instance creation attempts
- missing required secret state
- validation failure detail
- forbidden resource scope access

The frontend should distinguish:
- validation failure
- save failure
- authorization failure
- degraded history loading

The UI must not collapse the entire center because one integration detail request fails.

## 18. Auditing

This phase relies on existing admin audit infrastructure for configuration changes.
At minimum, audit records should capture:
- integration instance create/edit/disable
- secret rotation
- secret clear action
- binding changes
- policy changes

Validation history remains separate from admin audit logs.

## 19. Testing Strategy

### Backend
- repository tests for integration instance and validation history persistence
- router tests for unified admin contract
- adapter/service tests for:
  - DingTalk validation
  - Zendesk migration compatibility
  - OpenAI/Codex validation
- policy and permission guard tests

### Frontend
- shell tests for type switching and degraded loading
- detail view tests for each integration type
- secure-edit tests for secret rotation and clear behavior
- validation history tests
- migration coverage for Zendesk replacement path

### Verification
Before claiming completion, run at minimum:
- `cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-api && npm test && npm run build`
- `cd /Users/like/Desktop/baicells/Trae/agent-studio/agent-ui && npm test && npm run build`

## 20. Rollout Notes

Recommended rollout order:
1. introduce backend instance model and unified APIs
2. migrate Zendesk onto unified model without changing user-facing runtime behavior
3. add DingTalk and OpenAI/Codex admin surfaces
4. wire admin navigation to the new Integration Center
5. remove the standalone Zendesk admin path from normal navigation

## 21. Success Criteria

This sub-project is complete when:
- admin has a single Integration Center entry
- Zendesk editing is fully available there
- DingTalk configuration is manageable there
- OpenAI/Codex provider configuration is manageable there
- validation/test history is visible per integration instance
- secret rotation works without exposing previous secret values
- RBAC + resource policy rules protect access correctly
- Zendesk multi-instance support works without forcing a single global active instance

## 22. Future Extensions

This design intentionally leaves room for later additions:
- `git`
- `object_storage`
- generic `webhook`
- plugin-discovered integrations
- richer binding resolution logic
- provider failover or multiple model providers
- system-settings integration references

Those should build on this center, not replace it.
