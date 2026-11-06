import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "../i18n";
import { dispatchPortalRunFinished, useRunCompletionAttention } from "./run-attention";

const created: Array<{ title: string; body?: string }> = [];

class FakeNotification {
  static permission = "granted";
  static requestPermission = vi.fn(async () => "granted");
  onclick: (() => void) | null = null;
  constructor(title: string, options?: { body?: string }) {
    created.push({ title, body: options?.body });
  }
  close() {}
}

function Harness(props: { assistantName: string; threadTitle?: string }) {
  const holder = useRunCompletionAttention({
    enabled: true,
    assistantName: props.assistantName,
    resolveThreadTitle: () => props.threadTitle,
    onOpenThread: () => undefined
  });
  return <>{holder}</>;
}

function renderHarness(props: { assistantName: string; threadTitle?: string; locale: "en" | "zh-CN" }) {
  return render(
    <PortalI18nProvider brandKey="ranley" defaultLocale={props.locale} languageSwitcherEnabled={false}>
      <Harness assistantName={props.assistantName} threadTitle={props.threadTitle} />
    </PortalI18nProvider>
  );
}

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("Notification", FakeNotification);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  window.localStorage.clear();
});

describe("useRunCompletionAttention", () => {
  it("names the current brand's assistant in the desktop notification", () => {
    renderHarness({ assistantName: "Ranley", threadTitle: "Polaris alarm", locale: "en" });

    act(() => dispatchPortalRunFinished({ threadId: "t1", status: "completed" }));

    expect(created).toEqual([{ title: "Ranley finished", body: "Polaris alarm is ready." }]);
  });

  it("falls back to the assistant name when the task has no title", () => {
    renderHarness({ assistantName: "Ranley", locale: "zh-CN" });

    act(() => dispatchPortalRunFinished({ threadId: "t1", status: "failed" }));

    expect(created).toEqual([{ title: "Ranley 已完成", body: "「Ranley」需要你处理。" }]);
    expect(created[0]?.title).not.toContain("Bailey");
  });
});
