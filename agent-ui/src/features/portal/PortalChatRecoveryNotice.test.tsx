import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "./i18n";
import { PortalChatRecoveryNotice, recoveryNoticeDetail } from "./PortalChatRecoveryNotice";

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

  it("says the model service is busy and which retry is running", () => {
    render(
      <PortalI18nProvider>
        <PortalChatRecoveryNotice
          state="recovering"
          detail={recoveryNoticeDetail({ reason: "upstream_busy", attempt: 2, maxAttempts: 3 })}
        />
      </PortalI18nProvider>
    );

    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("The model service is busy. Retrying automatically (2 of 3)…");
    expect(status).toContain("No need to send it again");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("falls back to the connection notice for older recovery parts", () => {
    expect(recoveryNoticeDetail({ attempt: 2, maxAttempts: 2 })).toEqual({ reason: "connection", attempt: 2, maxAttempts: 2 });
    expect(recoveryNoticeDetail(undefined)).toEqual({ reason: "connection", attempt: undefined, maxAttempts: undefined });
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

  it("tells the user a send that never reached the server was not sent and offers to resend", () => {
    const onRerun = vi.fn();
    render(
      <PortalI18nProvider>
        <PortalChatRecoveryNotice state="failed" reason="send_not_delivered" canRerun onRerun={onRerun} />
      </PortalI18nProvider>
    );

    expect(screen.getByRole("alert").textContent).toContain("Network connection lost. Your message was not sent");
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    expect(onRerun).toHaveBeenCalledOnce();
  });
});
