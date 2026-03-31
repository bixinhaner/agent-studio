import { describe, expect, it } from "vitest";

import {
  closeWorkbenchDrawer,
  createInitialLayoutState,
  openWorkbenchDrawer,
  switchWorkbenchTab,
  toggleSessionRail
} from "./layout-state";

describe("layout-state", () => {
  it("starts with rail expanded and drawer closed", () => {
    expect(createInitialLayoutState()).toEqual({
      isSessionRailCollapsed: false,
      isRightDrawerOpen: false,
      activeRightDrawerTab: "writing",
      isAdvancedSettingsOpen: false
    });
  });

  it("toggles session rail", () => {
    const initial = createInitialLayoutState();
    expect(toggleSessionRail(initial).isSessionRailCollapsed).toBe(true);
  });

  it("opens and closes drawer while preserving active tab", () => {
    const initial = createInitialLayoutState();
    const opened = openWorkbenchDrawer(initial, "collaboration");
    expect(opened.isRightDrawerOpen).toBe(true);
    expect(opened.activeRightDrawerTab).toBe("collaboration");

    const switched = switchWorkbenchTab(opened, "writing");
    expect(switched.activeRightDrawerTab).toBe("writing");

    const closed = closeWorkbenchDrawer(switched);
    expect(closed.isRightDrawerOpen).toBe(false);
    expect(closed.activeRightDrawerTab).toBe("writing");
  });
});
