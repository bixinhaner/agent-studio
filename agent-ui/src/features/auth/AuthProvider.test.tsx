import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchWhoAmI: vi.fn(),
  fetchDingTalkConfig: vi.fn(),
  createDingTalkSession: vi.fn(),
  buildDingTalkAuthorizeUrl: vi.fn(),
  redirectTo: vi.fn()
}));

import { AUTH_INVALID_EVENT } from "../../lib/api";
import { buildDingTalkAuthorizeUrl, createDingTalkSession, fetchDingTalkConfig, fetchWhoAmI, redirectTo } from "./api";
import { AuthProvider, useAuth } from "./AuthProvider";

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <span>{auth.loading ? "loading" : "ready"}</span>
      <span>{auth.user ? `${auth.user.id}:${auth.user.role}` : "no-user"}</span>
      <span>{auth.error || "no-error"}</span>
      <button type="button" onClick={() => void auth.startSignIn()}>
        start-sign-in
      </button>
    </div>
  );
}

const mockedFetchWhoAmI = vi.mocked(fetchWhoAmI);
const mockedFetchDingTalkConfig = vi.mocked(fetchDingTalkConfig);
const mockedCreateDingTalkSession = vi.mocked(createDingTalkSession);
const mockedBuildDingTalkAuthorizeUrl = vi.mocked(buildDingTalkAuthorizeUrl);
const mockedRedirectTo = vi.mocked(redirectTo);

describe("AuthProvider", () => {
  beforeEach(() => {
    mockedFetchWhoAmI.mockReset();
    mockedFetchDingTalkConfig.mockReset();
    mockedCreateDingTalkSession.mockReset();
    mockedBuildDingTalkAuthorizeUrl.mockReset();
    mockedRedirectTo.mockReset();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("boots the current user from whoami", async () => {
    mockedFetchWhoAmI.mockResolvedValueOnce({
      user: {
        id: "user-1",
        role: "employee"
      }
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByText("ready")).toBeTruthy();
    expect(screen.getByText("user-1:employee")).toBeTruthy();
  });

  it("completes DingTalk callback sign-in from code and state", async () => {
    window.sessionStorage.setItem("agent_studio_dingtalk_nonce", "nonce-1");
    window.history.replaceState({}, "", "/callback?code=auth-code&state=oauth-state");
    mockedCreateDingTalkSession.mockResolvedValueOnce({
      user: {
        id: "user-2",
        role: "employee"
      }
    });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByText("user-2:employee")).toBeTruthy();
    expect(mockedCreateDingTalkSession).toHaveBeenCalledWith({
      code: "auth-code",
      state: "oauth-state",
      nonce: "nonce-1"
    });
    expect(window.sessionStorage.getItem("agent_studio_dingtalk_nonce")).toBeNull();
    expect(replaceStateSpy).toHaveBeenCalledWith({}, document.title, "/callback");
    expect(mockedFetchWhoAmI).not.toHaveBeenCalled();
  });

  it("shows the callback error and clears the nonce when DingTalk callback fails", async () => {
    window.sessionStorage.setItem("agent_studio_dingtalk_nonce", "nonce-2");
    window.history.replaceState({}, "", "/callback?code=bad-code&state=oauth-state");
    mockedCreateDingTalkSession.mockRejectedValueOnce(new Error("Invalid state"));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByText("ready")).toBeTruthy();
    expect(screen.getByText("no-user")).toBeTruthy();
    expect(screen.getByText("Invalid state")).toBeTruthy();
    expect(window.sessionStorage.getItem("agent_studio_dingtalk_nonce")).toBeNull();
    expect(mockedFetchWhoAmI).not.toHaveBeenCalled();
  });

  it("falls back to signed-out state when whoami is unauthorized", async () => {
    mockedFetchWhoAmI.mockRejectedValueOnce(new Error("Unauthorized"));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByText("ready")).toBeTruthy();
    expect(screen.getByText("no-user")).toBeTruthy();
    expect(screen.getByText("Unauthorized")).toBeTruthy();
  });

  it("starts DingTalk sign-in with config from the backend", async () => {
    mockedFetchWhoAmI.mockRejectedValueOnce(new Error("Unauthorized"));
    mockedFetchDingTalkConfig.mockResolvedValueOnce({
      config: {
        client_id: "ding-client",
        redirect_uri: "https://example.com/callback",
        response_type: "code",
        scope: "openid",
        state: "server-state",
        nonce: "nonce-1"
      }
    });
    mockedBuildDingTalkAuthorizeUrl.mockReturnValueOnce("https://login.dingtalk.com/oauth2/auth?test=1");

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByText("ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "start-sign-in" }));

    await waitFor(() => {
      expect(mockedFetchDingTalkConfig).toHaveBeenCalledTimes(1);
      expect(mockedBuildDingTalkAuthorizeUrl).toHaveBeenCalledWith({
        client_id: "ding-client",
        redirect_uri: "https://example.com/callback",
        response_type: "code",
        scope: "openid",
        state: "server-state",
        nonce: "nonce-1"
      });
      expect(window.sessionStorage.getItem("agent_studio_dingtalk_nonce")).toBe("nonce-1");
      expect(mockedRedirectTo).toHaveBeenCalledWith("https://login.dingtalk.com/oauth2/auth?test=1");
    });
  });

  it("returns to signed-out state when auth becomes invalid", async () => {
    mockedFetchWhoAmI.mockResolvedValueOnce({
      user: {
        id: "user-1",
        role: "employee"
      }
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByText("user-1:employee")).toBeTruthy();
    window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: { status: 401 } }));

    await waitFor(() => {
      expect(screen.getByText("no-user")).toBeTruthy();
      expect(screen.getByText("登录状态已失效，请重新登录。" )).toBeTruthy();
    });
  });
});
