export type PortalComposerKeyDownAction = "ime" | "submit" | "native";

export function resolvePortalComposerKeyDownAction(input: {
  key: string;
  keyCode: number;
  shiftKey: boolean;
  isComposing: boolean;
  threadRunning: boolean;
}): PortalComposerKeyDownAction {
  // Some IMEs report composition through the legacy 229 key code or the
  // Process key even when KeyboardEvent.isComposing has already turned false.
  if (input.isComposing || input.keyCode === 229 || input.key === "Process") {
    return "ime";
  }
  if (input.key === "Enter" && !input.shiftKey && !input.threadRunning) {
    return "submit";
  }
  return "native";
}
