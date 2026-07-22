import { describe, expect, it } from "vitest";

import { classifyAssistantLinkHref } from "./assistant-link-behavior";

const PORTAL_URL = "https://portal.example.com/chat?thread=thread-1";

describe("classifyAssistantLinkHref", () => {
  it.each([
    "https://external.example.com/docs",
    "https://portal.example.com/settings",
    "/portal/resources",
    "relative/page",
    "//external.example.com/docs"
  ])("opens assistant-authored navigation in a new tab: %s", (href) => {
    expect(classifyAssistantLinkHref(href, PORTAL_URL)).toBe("new-tab");
  });

  it("keeps same-document anchors in the current document", () => {
    expect(classifyAssistantLinkHref("#section-2", PORTAL_URL)).toBe("same-document");
  });

  it.each(["mailto:support@example.com", "tel:+123456789"])("delegates system links: %s", (href) => {
    expect(classifyAssistantLinkHref(href, PORTAL_URL)).toBe("system");
  });

  it.each(["", "javascript:alert(1)", "data:text/html,unsafe", "blob:https://portal.example.com/id", "file:///tmp/report.html"])(
    "blocks non-navigable or unsafe links: %s",
    (href) => {
      expect(classifyAssistantLinkHref(href, PORTAL_URL)).toBe("blocked");
    }
  );
});
