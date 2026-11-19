import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { updatePortalPreferences } from "./api";
import { MemoryDrawer } from "./MemoryDrawer";
import { NotificationSettingsDrawer } from "./NotificationSettingsDrawer";
import { OnboardingTour } from "./OnboardingTour";
import { TeamDrawer } from "./TeamDrawer";
import { ScheduledTasksDrawer, type ScheduledTaskContext, type ScheduledTaskPrefill } from "./ScheduledTasksDrawer";
import { UsageDrawer } from "./UsageDrawer";
import type { PortalResolvedTheme, PortalThemePreference } from "./use-portal-theme";

export type PortalRoadmapApi = {
  /** Personal features (scheduled tasks, memory, notifications) are internal-employee only. */
  personalFeaturesEnabled: boolean;
  usageEnabled: boolean;
  /** Customer organization admins manage their team. */
  teamEnabled: boolean;
  tourEnabled: boolean;
  theme: { preference: PortalThemePreference; resolved: PortalResolvedTheme; setPreference(next: PortalThemePreference): void };
  /** Bumps whenever the scheduled tasks drawer closes so summaries can refresh. */
  scheduledTasksVersion: number;
  openScheduledTasks(prefill?: ScheduledTaskPrefill | null): void;
  openMemory(): void;
  openUsage(): void;
  openTeam(): void;
  openNotificationSettings(): void;
  startTour(): void;
};

const PortalRoadmapContext = createContext<PortalRoadmapApi | null>(null);

export function usePortalRoadmap(): PortalRoadmapApi | null {
  return useContext(PortalRoadmapContext);
}

export function PortalRoadmapProvider(props: {
  children: ReactNode;
  personalFeaturesEnabled: boolean;
  /** "My usage" is available to every signed-in portal user, including external ones. */
  usageEnabled: boolean;
  teamEnabled?: boolean;
  tourEnabled: boolean;
  /** Undefined while the user is still loading; tour auto-shows once when empty. */
  onboardingCompletedAt: string | null | undefined;
  userLoaded: boolean;
  theme: PortalRoadmapApi["theme"];
  scheduledTaskContext: ScheduledTaskContext;
  modeLabel(modeId: string | null): string | undefined;
  onOpenThread(threadId: string): void;
  initialView?: "scheduled-tasks" | "team" | null;
  /** Switches to a view where the composer targets exist before the tour measures them. */
  prepareTour?(): void | Promise<unknown>;
}) {
  const [tasksOpen, setTasksOpen] = useState(false);
  const [prefill, setPrefill] = useState<ScheduledTaskPrefill | null>(null);
  const [tasksVersion, setTasksVersion] = useState(0);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const teamEnabled = Boolean(props.teamEnabled);
  const teamViewHandled = useRef(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const autoTourDecided = useRef(false);
  const initialViewHandled = useRef(false);
  const prepareTourRef = useRef(props.prepareTour);
  prepareTourRef.current = props.prepareTour;
  const prepareTour = useCallback(() => prepareTourRef.current?.(), []);

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

  // Join-request emails link to /?view=team so org admins land on the request.
  useEffect(() => {
    if (teamViewHandled.current || !teamEnabled || props.initialView !== "team") return;
    teamViewHandled.current = true;
    setTeamOpen(true);
  }, [props.initialView, teamEnabled]);

  const openScheduledTasks = useCallback((next?: ScheduledTaskPrefill | null) => {
    setPrefill(next ?? null);
    setTasksOpen(true);
  }, []);
  const openMemory = useCallback(() => setMemoryOpen(true), []);
  const openUsage = useCallback(() => setUsageOpen(true), []);
  const openTeam = useCallback(() => setTeamOpen(true), []);
  const openNotificationSettings = useCallback(() => setNotifyOpen(true), []);
  const startTour = useCallback(() => setTourOpen(true), []);

  const value = useMemo<PortalRoadmapApi>(
    () => ({
      personalFeaturesEnabled: props.personalFeaturesEnabled,
      usageEnabled: props.usageEnabled,
      teamEnabled,
      tourEnabled: props.tourEnabled,
      theme: props.theme,
      scheduledTasksVersion: tasksVersion,
      openScheduledTasks,
      openMemory,
      openUsage,
      openTeam,
      openNotificationSettings,
      startTour
    }),
    [openMemory, openNotificationSettings, openScheduledTasks, openTeam, openUsage, props.personalFeaturesEnabled, teamEnabled, props.theme, props.tourEnabled, props.usageEnabled, startTour, tasksVersion]
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
              setTasksVersion((current) => current + 1);
            }}
            onOpenThread={(threadId) => {
              setTasksOpen(false);
              setTasksVersion((current) => current + 1);
              onOpenThread(threadId);
            }}
          />
          <MemoryDrawer open={memoryOpen} onClose={() => setMemoryOpen(false)} modeLabel={props.modeLabel} />
          <NotificationSettingsDrawer
            open={notifyOpen}
            onClose={() => setNotifyOpen(false)}
            onOpenScheduledTasks={() => {
              setNotifyOpen(false);
              openScheduledTasks();
            }}
          />
        </>
      ) : null}
      {teamEnabled ? <TeamDrawer open={teamOpen} onClose={() => setTeamOpen(false)} /> : null}
      {props.usageEnabled ? <UsageDrawer open={usageOpen} onClose={() => setUsageOpen(false)} /> : null}
      {props.tourEnabled ? (
        <OnboardingTour
          open={tourOpen}
          prepare={prepareTour}
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
