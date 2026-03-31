# Agent Studio Portal H1 Workbench Redesign Design

## Goal

Redesign the employee portal workbench with a "chat-first" interaction model while preserving existing runtime capabilities.

Primary success criteria:

1. Users can ask immediately on first entry without touching advanced configuration.
2. The main chat area is always the dominant visual area.
3. Session and collaboration capabilities remain complete but move to on-demand surfaces.
4. The interface feels like a mature enterprise product (clean hierarchy, consistent components, predictable interaction).

## Scope

### In scope

- Portal shell information architecture redesign (H1 variant).
- Session rail behavior redesign (collapsible, chat-history-first).
- Chat empty state redesign with starter cards.
- Right-side drawer redesign with two tabs (`写作`, `协作`) and priority ordering.
- "Advanced Settings" migration from always-visible panel to on-demand panel.
- Visual system unification for portal surfaces.
- Frontend refactor plan for splitting the current monolithic portal shell.

### Out of scope

- Backend API contract changes.
- Runtime protocol changes.
- Assistant core message rendering replacement.
- New permission model semantics.
- New collaboration features beyond existing capability set.

## Current State Summary

Current portal UI is implemented primarily in:

- `agent-ui/src/features/portal/PortalShell.tsx` (monolithic, ~2763 lines)
- `agent-ui/src/styles.css` (global stylesheet, ~2889 lines)

Observed problems:

1. Configuration-first UI competes with chat-first intent.
2. Session, runtime options, and collaboration controls are all visible at once, creating cognitive load.
3. Collaboration panel is functionally rich but visually noisy for first-time usage.
4. Large single-file implementation increases change risk and slows UI iteration.

## Design Direction (Approved)

The selected direction is H1: **Focus + Drawer**.

Core principles:

1. Default to direct chat input.
2. Keep power features, but hide them behind explicit entry points.
3. Keep feature completeness; optimize placement and priority instead of removing capabilities.
4. Follow a DeepSeek-like left-rail mental model (session controls grouped with session list, user identity at rail bottom).

## Information Architecture

### Layout regions

1. **Top Bar**
   - Minimal controls only:
     - session rail toggle
     - advanced settings entry
     - global status tags (compact)
2. **Left Session Rail (collapsible)**
   - Top section:
     - `新会话`
     - session search
   - Middle section:
     - session history list
   - Bottom section:
     - user identity summary and account entry
3. **Main Chat Stage**
   - Dominant central region
   - Empty state shows starter cards
   - Active conversation state fully covers starter area
4. **Right Drawer**
   - Triggered by persistent button
   - Two tabs:
     - `写作`
     - `协作`

### Region behavior

1. Left rail defaults to collapsed.
2. Chat stage never shrinks below primary reading width because of right-side capability panels.
3. Right panel is drawer-only (not persistent split panel) in H1.

## Interaction Model

### Session flow

1. First entry:
   - chat stage shows starter cards
   - input box is immediately available
2. First user message sent:
   - starter cards disappear
   - message stream takes full stage ownership
3. `新会话` action:
   - creates fresh thread
   - returns stage to starter card mode

### Session rail behavior

1. Session controls (`新会话`, search) are grouped with session history in the rail.
2. Rail can be expanded/collapsed without affecting chat continuity.
3. User identity remains fixed at rail bottom.

### Right drawer behavior

The drawer preserves full functionality while prioritizing high-value actions.

#### `写作` tab

Priority top block:

1. Structured output generation (`结构化产出`)
2. Generate document from current thread (`基于当前会话生成文档`)

Secondary block:

- Additional writing tools retained under expandable "more tools" section.

#### `协作` tab

Priority top block:

1. Comments and mentions (`评论与@提及`)
2. Knowledge capture marker (`知识捕获`)

Secondary block:

- Sharing scope
- Owner/follower assignment
- Other existing collaboration controls retained in expandable "more settings" section.

## Visual System

### Tone

Enterprise, calm, trustworthy, high readability.

### Color strategy

1. Neutral/slate base for backgrounds and text.
2. Controlled blue accents for primary actions and active state.
3. Dedicated semantic colors for success/warning/error.
4. Avoid decorative gradients in core productivity regions.

### Typography strategy

1. Chinese-first readable sans stack (prefer `Noto Sans SC` in design token layer).
2. Tight type scale:
   - heading hierarchy: 3 levels
   - content hierarchy: 2 levels
3. Meta/status text kept one level smaller for stable visual rhythm.

### Motion

1. Drawer and hover transitions in 150-220ms range.
2. No decorative long-running animation in core workflow surfaces.

## Technical Architecture

### Refactor target

Split current `PortalShell` into bounded UI units while preserving existing business adapters and runtime wiring.

Proposed components:

1. `PortalTopBar`
2. `SessionRail`
3. `ChatStage`
4. `StarterCards`
5. `RightDrawer`
6. `AdvancedSettingsPanel`

### Ownership boundaries

1. Runtime adapters, stream handling, and thread persistence remain in portal runtime layer.
2. Layout/visual orchestration moves to shell-level UI components.
3. Collaboration and writing panels become drawer-contained feature surfaces with priority sections.

### UI framework strategy

Adopt mixed strategy:

1. Keep `assistant-ui` for message thread, composer, and assistant message rendering.
2. Introduce Ant Design components for shell scaffolding:
   - `Layout`
   - `Drawer`
   - `Tabs`
   - `Button`
   - `Input`
   - `Tooltip`
3. Do not replace assistant message primitives in this phase.

## Data Flow and State

### Unchanged data sources

1. Existing thread list APIs and runtime session APIs.
2. Existing collaboration APIs.
3. Existing runtime options and portal resource endpoints.

### New UI state responsibilities

1. `isSessionRailCollapsed`
2. `isRightDrawerOpen`
3. `activeRightDrawerTab` (`写作` or `协作`)
4. `showStarterCards` (derived from thread/message state)
5. `isAdvancedSettingsOpen`

## Error Handling

1. Keep current API error semantics.
2. Drawer actions surface inline error feedback without collapsing the drawer.
3. Session rail actions (`新会话`, search, rename) keep current confirmation patterns.
4. If collaboration state load fails, show actionable retry state inside collaboration section instead of blocking chat.

## Accessibility and Timezone

### Accessibility

1. Keyboard navigable rail toggle, drawer trigger, drawer tabs, and starter cards.
2. Explicit visible focus states for all interactive controls.
3. Reading order must match visual order.
4. Preserve semantic headings and aria labels in shell regions.

### Timezone

All frontend time rendering continues to follow local user timezone behavior (existing `toLocaleString`/`Intl.DateTimeFormat` pattern).

## Phased Delivery Plan

### Phase 1: Shell scaffolding

1. Introduce top bar + collapsible session rail + chat-stage-first layout.
2. Keep existing collaboration panel temporarily functional during transition.

### Phase 2: Drawer migration

1. Move writing/collaboration capabilities into right drawer with two tabs.
2. Keep all existing functionality reachable.

### Phase 3: Starter card and prioritization polish

1. Add starter card behavior and event wiring.
2. Reorder writing/collaboration sections by priority.
3. Final visual token alignment and consistency pass.

## Risks and Mitigations

1. Risk: behavior regression from large-file refactor.
   - Mitigation: split UI shell first; keep runtime logic untouched.
2. Risk: discoverability drop for hidden controls.
   - Mitigation: persistent drawer trigger and concise onboarding hints.
3. Risk: starter cards become noise.
   - Mitigation: cap to 3-6 concise, click-to-send cards.

## Acceptance Criteria

1. User can send first prompt immediately on entry without opening advanced settings.
2. Session rail can collapse/expand; `新会话` and search are grouped in rail.
3. User identity is visible at rail bottom.
4. Chat stage is visually dominant and not permanently compressed by side panels.
5. Right drawer includes `写作` and `协作` tabs.
6. `写作` tab top priority contains structured output and thread-to-document actions.
7. `协作` tab top priority contains comments/mentions and knowledge capture.
8. Full collaboration capability remains accessible through secondary sections.
9. Starter cards appear only for unstarted conversation state and are replaced once conversation begins.
10. Local timezone rendering behavior remains correct.

## Verification Requirements

Before considering implementation complete:

1. Targeted portal UI tests for:
   - session rail collapse/expand
   - new chat/search location behavior
   - drawer open/close and tab switching
   - starter cards state transitions
2. Collaboration and writing action regressions covered by targeted tests.
3. Full frontend test run and build pass.

