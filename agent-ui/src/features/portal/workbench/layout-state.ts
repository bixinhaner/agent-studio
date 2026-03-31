export type WorkbenchTab = "writing" | "collaboration";

export type WorkbenchLayoutState = {
  isSessionRailCollapsed: boolean;
  isRightDrawerOpen: boolean;
  activeRightDrawerTab: WorkbenchTab;
  isAdvancedSettingsOpen: boolean;
};

export function createInitialLayoutState(): WorkbenchLayoutState {
  return {
    isSessionRailCollapsed: true,
    isRightDrawerOpen: false,
    activeRightDrawerTab: "writing",
    isAdvancedSettingsOpen: false
  };
}

export function toggleSessionRail(state: WorkbenchLayoutState): WorkbenchLayoutState {
  return {
    ...state,
    isSessionRailCollapsed: !state.isSessionRailCollapsed
  };
}

export function openWorkbenchDrawer(
  state: WorkbenchLayoutState,
  tab: WorkbenchTab = state.activeRightDrawerTab
): WorkbenchLayoutState {
  return {
    ...state,
    isRightDrawerOpen: true,
    activeRightDrawerTab: tab
  };
}

export function closeWorkbenchDrawer(state: WorkbenchLayoutState): WorkbenchLayoutState {
  return {
    ...state,
    isRightDrawerOpen: false
  };
}

export function switchWorkbenchTab(state: WorkbenchLayoutState, tab: WorkbenchTab): WorkbenchLayoutState {
  return {
    ...state,
    activeRightDrawerTab: tab
  };
}

