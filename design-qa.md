final result: passed

Target: Portal composer Option 1 (queue tray plus independent recovery bar)

Evidence:
- Compared the selected Option 1 reference with the browser-rendered implementation states.
- Captured running, queued, steered, editing, deleted/undo, interrupted/recovery, failed/retry, and restored-draft states in Chinese.
- Captured the interrupted/recovery state in English.
- Verified the interrupted state at a 390 x 844 mobile viewport: no horizontal overflow and both recovery actions are 44 px high.
- Verified the desktop queued state has three ordered rows, three immediate-steer actions, no horizontal overflow, and 18 focusable controls.
- Browser console contained no warnings or errors from the QA page.

Checks passed:
- Visual hierarchy matches the selected direction: recovery is separate from the queue, and Stop remains an independent destructive control.
- Queue actions cover reorder, edit, delete/undo, immediate steer, failure retry, and continuation after interruption.
- Focus-visible styles and keyboard reorder/edit affordances are present.
- Chinese and English copy use the portal i18n layer.
- Desktop and mobile layouts preserve readable content and usable touch targets.

Screenshot directory: `temp/product-design/portal-queue/`
