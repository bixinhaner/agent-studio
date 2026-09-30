import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { updatePortalPreferences } from "./api";
import { MemoryDrawer } from "./MemoryDrawer";
import { OnboardingTour } from "./OnboardingTour";
import { ScheduledTasksDrawer, type ScheduledTaskContext, type ScheduledTaskPrefill } from "./ScheduledTasksDrawer";
import { SubscriptionsDrawer } from "./SubscriptionsDrawer";
import type { PortalResolvedTheme, PortalThemePreference } from "./use-portal-theme";

export type PortalRoadmapApi = {
  /** Personal features (tasks, subscriptions, memory) are internal-employee only. */
  personalFeaturesEnabled: boolean;
  tourEnabled: boolean;
  theme: { preference: PortalThemePreference; resolved: PortalResolvedTheme; setPreference(next: PortalThemePreference): void };
  openScheduledTasks(prefill?: ScheduledTaskPrefill | null): void;
  openSubscriptions(): void;
  openMemory(): void;
  startTour(): void;
};

const PortalRoadmapContext = createContext<PortalRoadmapApi | null>(null);

export function usePortalRoadmap(): PortalRoadmapApi | null {
  return useContext(PortalRoadmapContext);
}

export function PortalRoadmapProvider(props: {
  children: ReactNode;
  personalFeaturesEnabled: boolean;
  tourEnabled: boolean;
  /** Undefined while the user is still loading; tour auto-shows once when empty. */
  onboardingCompletedAt: string | null | undefined;
  userLoaded: boolean;
  theme: PortalRoadmapApi["theme"];
  scheduledTaskContext: ScheduledTaskContext;
  modeLabel(modeId: string | null): string | undefined;
  onOpenThread(threadId: string): void;
  initialView?: "scheduled-tasks" | null;
}) {
  const [tasksOpen, setTasksOpen] = useState(false);
  const [prefill, setPrefill] = useState<ScheduledTaskPrefill | null>(null);
  const [subsOpen, setSubsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const autoTourDecided = useRef(false);
  const initialViewHandled = useRef(false);

  useEffect(() => {
    if (autoTourDecided.current || !props.userLoaded) return;
    autoTourDecided.current = true;
    if (!props.tourEnabled || props.onboardingCompletedAt) return;
    // Let the workbench lay out first so tour targets resolve.
    const timer = window.setTimeout(() => setTourOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [props.onboardingCompletedAt, props.tourEnabled, props.userLoaded]);

  useEffect(() => {
    if (initialViewHandled.current || !props.personalFeaturesEnabled) return;
    if (props.initialView === "scheduled-tasks") {
      initialViewHandled.current = true;
      setTasksOpen(true);
    }
  }, [props.initialView, props.personalFeaturesEnabled]);

  const openScheduledTasks = useCallback((next?: ScheduledTaskPrefill | null) => {
    setPrefill(next ?? null);
    setTasksOpen(true);
  }, []);
  const openSubscriptions = useCallback(() => setSubsOpen(true), []);
  const openMemory = useCallback(() => setMemoryOpen(true), []);
  const startTour = useCallback(() => setTourOpen(true), []);

  const value = useMemo<PortalRoadmapApi>(
    () => ({
      personalFeaturesEnabled: props.personalFeaturesEnabled,
      tourEnabled: props.tourEnabled,
      theme: props.theme,
      openScheduledTasks,
      openSubscriptions,
      openMemory,
      startTour
    }),
    [openMemory, openScheduledTasks, openSubscriptions, props.personalFeaturesEnabled, props.theme, props.tourEnabled, startTour]
  );

  const onOpenThread = props.onOpenThread;
  return (
    <PortalRoadmapContext.Provider value={value}>
      {props.children}
      {props.personalFeaturesEnabled ? (
        <>
          <ScheduledTasksDrawer
            open={tasksOpen}
            prefill={prefill}
            context={props.scheduledTaskContext}
            onClose={() => {
              setTasksOpen(false);
              setPrefill(null);
            }}
            onOpenThread={(threadId) => {
              setTasksOpen(false);
              onOpenThread(threadId);
            }}
          />
          <SubscriptionsDrawer open={subsOpen} onClose={() => setSubsOpen(false)} />
          <MemoryDrawer open={memoryOpen} onClose={() => setMemoryOpen(false)} modeLabel={props.modeLabel} />
        </>
      ) : null}
      {props.tourEnabled ? (
        <OnboardingTour
          open={tourOpen}
          onClose={() => {
            setTourOpen(false);
            // Skipping also counts: the tour is shown automatically only once.
            void updatePortalPreferences({ onboarding_completed: true }).catch(() => undefined);
          }}
        />
      ) : null}
    </PortalRoadmapContext.Provider>
  );
}
