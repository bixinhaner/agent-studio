import { type ReactNode } from "react";
import { createPortal } from "react-dom";

export async function copyTextToClipboard(value: string): Promise<void> {
  const text = value.trim();
  if (!text) {
    throw new Error("Nothing to copy");
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Your browser does not support automatic copy. Please copy the link manually.");
  }
}

export function portalIntoSlot(slot: HTMLElement | null, node: ReactNode): ReactNode {
  return slot ? createPortal(node, slot) : node;
}
