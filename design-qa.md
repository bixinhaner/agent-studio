# Harmonized steer event design QA

final result: passed

## Comparison target

- ImageGen visual truth generated from the current Bailey Portal and queue workflow:
  - `temp/product-design/steer-event-harmonized/01-pending.png`
  - `temp/product-design/steer-event-harmonized/02-accepted.png`
  - `temp/product-design/steer-event-harmonized/03-failed.png`
- Browser-rendered implementation using the production React components and styles:
  - `temp/audits/steer-event-harmonized-20260809/implementation/01-pending-zh.png`
  - `temp/audits/steer-event-harmonized-20260809/implementation/02-accepted-zh.png`
  - `temp/audits/steer-event-harmonized-20260809/implementation/03-failed-zh.png`
  - `temp/audits/steer-event-harmonized-20260809/implementation/04-failed-en.png`
  - `temp/audits/steer-event-harmonized-20260809/implementation/05-mobile-zh-failed.png`
- Full-view combined comparison: `temp/audits/steer-event-harmonized-20260809/implementation/full-failed-comparison.png`
- Focused combined comparisons, with the ImageGen target on the left and implementation on the right:
  - `temp/audits/steer-event-harmonized-20260809/implementation/01-pending-comparison.png`
  - `temp/audits/steer-event-harmonized-20260809/implementation/02-accepted-comparison.png`
  - `temp/audits/steer-event-harmonized-20260809/implementation/03-failed-comparison.png`

## Viewport and normalization

- Desktop implementation was exercised in the user's Chrome at `1440 x 657` CSS pixels with device pixel ratio `2`.
- Mobile implementation was exercised at `390 x 844` CSS pixels and the temporary viewport override was reset after the test.
- Source and implementation were normalized to the same `1440 x 657` comparison canvas before the focused same-state crops were combined.
- The harness uses the production `PortalSteerEventList`, `PortalQueueTray`, localization provider, Portal stylesheet, desktop message-width tokens, and mobile breakpoint. Only the surrounding assistant answer and composer shell are simplified.

## States and interactions tested

- Pending direction appears immediately under its source answer with an animated progress icon and localized `正在应用到当前回答…` / `Applying to current response…` copy.
- Accepted direction resolves to the localized success state and green semantic surface.
- Failed direction retains the original text and exposes `重试` / `编辑后重试` while the response is running.
- Retry was clicked in Chrome and transitioned visibly from failed to pending and then accepted.
- After the response ends, the failed event changes recovery to `加入队列` / `编辑`; `加入队列` was clicked and produced the expected feedback.
- Chinese and English states both rendered from localization keys rather than component literals.
- Browser logs contained only Vite debug messages and the React development notice; no warning or error entries were present.

## Required fidelity surfaces

- Placement: persisted and optimistic events are attached to their source user turn and rendered immediately after the corresponding assistant answer. A narrow footer fallback remains only for legacy or temporarily unanchored events, preventing historical directions from accumulating above the composer.
- Width and hierarchy: at the desktop test viewport, the failed event measured `256 x 99.7px`, the message column `832px`, the composer `713.9px`, and the queue content `693.7px`. The event is therefore content-sized and right-aligned instead of competing with the queue as a second full-width tray.
- Shape and elevation: the card reuses the user-message lower-right corner language (`16px 16px 4px 16px`), a one-pixel semantic border, and low `0 2px 10px` elevation.
- Colors and actions: pending uses the Portal warm accent surface, accepted uses green, and failure uses red. Primary recovery follows the queue's filled orange action style; secondary recovery stays neutral. No unrelated blue link treatment remains.
- Mobile: the event measured `280px` wide inside a `308px` composer column, the document had no horizontal overflow, and both recovery actions measured `44px` high.
- Accessibility: status/alert semantics, labelled history region, focus-visible treatment, keyboard-reachable controls, reduced-motion handling, and mobile touch targets were retained.

## Comparison history

1. The new ImageGen target established the final visual relationship: a right-aligned, content-sized direction bubble above the existing full-width queue tray, with Portal orange actions and semantic state surfaces.
2. The first Chrome pass exposed a QA-harness mismatch: the production message-width custom properties normally supplied by `.aui-thread-root` were absent, so the answer and composer collapsed to intrinsic width. The harness was corrected to use the production desktop and mobile variables; product source did not need a workaround.
3. Same-state combined comparisons then confirmed the event/queue hierarchy, corner language, state colors, low shadow, and action priority. The implementation is slightly more compact than the ImageGen rendering because it preserves the real Portal density and existing queue component rather than copying generated geometry.
4. Final pass found no actionable P0, P1, or P2 differences.

## Findings

- No actionable P0, P1, or P2 findings remain.

## Residual test gap

- The full local Portal cannot reuse the production login cookie on localhost. The complete page was therefore validated through production component integration and builds, while visual and interaction QA used the authenticated Chrome session with a local production-component harness.
