import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "./i18n";
import { PortalChatRecoveryNotice } from "./PortalChatRecoveryNotice";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe("PortalChatRecoveryNotice", () => {
  it("announces automatic recovery without asking the user to act", () => {
    render(
      <PortalI18nProvider>
        <PortalChatRecoveryNotice state="recovering" />
      </PortalI18nProvider>
    );

    expect(screen.getByRole("status").textContent).toContain("Connection interrupted. Recovering automatically…");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers one clear rerun action after automatic recovery fails", () => {
    const onRerun = vi.fn();
    render(
      <PortalI18nProvider>
        <PortalChatRecoveryNotice state="failed" canRerun onRerun={onRerun} />
      </PortalI18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(onRerun).toHaveBeenCalledOnce();
  });
});
