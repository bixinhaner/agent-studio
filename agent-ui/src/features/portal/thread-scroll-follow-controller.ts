import {
  resolveThreadScrollFollowMode,
  type ThreadScrollFollowMode
} from "./thread-reading-position";

export type ThreadScrollFollowController = {
  getMode: () => ThreadScrollFollowMode;
  onUserSend: () => ThreadScrollFollowMode;
  onUserScrollUp: () => ThreadScrollFollowMode;
  onViewportChange: (atBottom: boolean) => ThreadScrollFollowMode;
  shouldFollowPassiveContent: () => boolean;
};

export function createThreadScrollFollowController(
  initialMode: ThreadScrollFollowMode = "reading-history"
): ThreadScrollFollowController {
  let mode = initialMode;
  const transition = (
    event: Parameters<typeof resolveThreadScrollFollowMode>[0]["event"]
  ) => {
    mode = resolveThreadScrollFollowMode({ current: mode, event });
    return mode;
  };

  return {
    getMode: () => mode,
    onUserSend: () => transition("user-send"),
    onUserScrollUp: () => transition("user-scroll-up"),
    onViewportChange: (atBottom) => transition(
      atBottom ? "viewport-at-bottom" : "viewport-away-from-bottom"
    ),
    shouldFollowPassiveContent: () => mode === "following"
  };
}
