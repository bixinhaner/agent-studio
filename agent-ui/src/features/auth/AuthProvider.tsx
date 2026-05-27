import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { AUTH_INVALID_EVENT } from "../../lib/api";
import {
  buildDingTalkAuthorizeUrl,
  createCrestSession,
  createDingTalkSession,
  fetchDingTalkConfig,
  fetchWhoAmI,
  logoutSession,
  redirectTo,
  requestEmailSignIn,
  selectActiveOrganization,
  updateCurrentUserPortalPreferences,
  verifyEmailSignIn,
  type AuthIdentity,
  type AuthMembership,
  type AuthOrganization,
  type AuthUserPortalPreferences,
  type AuthSession,
  type AuthUser,
  type EmailRequestResponse
} from "./api";

type AuthContextValue = {
  loading: boolean;
  user: AuthUser | null;
  activeOrganization: AuthOrganization | null;
  memberships: AuthMembership[];
  identities: AuthIdentity[];
  error: string | null;
  reload: () => Promise<void>;
  clearError: () => void;
  startSignIn: () => Promise<void>;
  requestEmailSignIn: (input: { email?: string; inviteToken?: string }) => Promise<EmailRequestResponse>;
  verifyEmailSignIn: (input: { email: string; code: string; inviteToken?: string }) => Promise<void>;
  selectOrganization: (organizationId: string) => Promise<void>;
  updatePortalPreferences: (input: AuthUserPortalPreferences) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const DINGTALK_NONCE_KEY = "agent_studio_dingtalk_nonce";
const POST_AUTH_REDIRECT_KEY = "agent_studio_post_auth_redirect";

function authErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) {
    const detail = error.message.trim();
    if (!detail || detail === "Unauthorized") {
      return null;
    }
    return detail;
  }
  return "Failed to load authentication state";
}

function emptySession(): Pick<AuthContextValue, "user" | "activeOrganization" | "memberships" | "identities"> {
  return {
    user: null,
    activeOrganization: null,
    memberships: [],
    identities: []
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applySession(next: AuthSession | null) {
    setSession(next);
  }

  function resetSession() {
    applySession(null);
  }

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWhoAmI();
      applySession(next);
    } catch (err) {
      resetSession();
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onAuthInvalid = () => {
      resetSession();
      setLoading(false);
      setError("Your session has expired. Please sign in again.");
    };

    async function bootstrap() {
      const params = new URLSearchParams(window.location.search);
      const crestCode = params.get("crest_sso_code")?.trim() || "";
      const code = params.get("code")?.trim() || "";
      const state = params.get("state")?.trim() || "";
      if (crestCode) {
        try {
          const next = await createCrestSession({ code: crestCode });
          applySession(next);
          setError(null);
          params.delete("crest_sso_code");
          params.delete("state");
          const nextSearch = params.toString();
          window.history.replaceState(
            {},
            document.title,
            `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`
          );
        } catch (err) {
          resetSession();
          setError(authErrorMessage(err));
        } finally {
          setLoading(false);
        }
        return;
      }
      if (code && state) {
        const nonce = window.sessionStorage.getItem(DINGTALK_NONCE_KEY) || "";
        try {
          const next = await createDingTalkSession({ code, state, nonce });
          applySession(next);
          setError(null);
          const redirectPath = window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY)?.trim();
          const nextLocation = redirectPath || `${window.location.pathname}${window.location.hash}`;
          window.history.replaceState({}, document.title, nextLocation);
        } catch (err) {
          resetSession();
          setError(authErrorMessage(err));
        } finally {
          window.sessionStorage.removeItem(DINGTALK_NONCE_KEY);
          window.sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
          setLoading(false);
        }
        return;
      }

      await reload();
    }

    window.addEventListener(AUTH_INVALID_EVENT, onAuthInvalid);
    void bootstrap();
    return () => {
      window.removeEventListener(AUTH_INVALID_EVENT, onAuthInvalid);
    };
  }, []);

  async function startSignIn() {
    setError(null);
    try {
      const { config } = await fetchDingTalkConfig();
      window.sessionStorage.setItem(DINGTALK_NONCE_KEY, config.nonce);
      window.sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, `${window.location.pathname}${window.location.hash}`);
      redirectTo(buildDingTalkAuthorizeUrl(config));
    } catch (err) {
      setError(authErrorMessage(err));
      throw err;
    }
  }

  async function requestEmailCode(input: { email?: string; inviteToken?: string }) {
    setError(null);
    try {
      return await requestEmailSignIn(input);
    } catch (err) {
      setError(authErrorMessage(err));
      throw err;
    }
  }

  async function completeEmailSignIn(input: {
    email: string;
    code: string;
    inviteToken?: string;
  }) {
    setError(null);
    try {
      const next = await verifyEmailSignIn(input);
      applySession(next);
    } catch (err) {
      setError(authErrorMessage(err));
      throw err;
    }
  }

  async function changeOrganization(organizationId: string) {
    setError(null);
    try {
      const next = await selectActiveOrganization(organizationId);
      applySession(next);
    } catch (err) {
      setError(authErrorMessage(err));
      throw err;
    }
  }

  async function updatePortalPreferences(input: AuthUserPortalPreferences) {
    setError(null);
    try {
      const next = await updateCurrentUserPortalPreferences(input);
      applySession(next);
    } catch (err) {
      setError(authErrorMessage(err));
      throw err;
    }
  }

  async function signOut() {
    setError(null);
    try {
      await logoutSession();
    } finally {
      window.sessionStorage.removeItem(DINGTALK_NONCE_KEY);
      resetSession();
      setLoading(false);
    }
  }

  const sessionValue = session ?? emptySession();
  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      user: sessionValue.user,
      activeOrganization: sessionValue.activeOrganization,
      memberships: sessionValue.memberships,
      identities: sessionValue.identities,
      error,
      reload,
      clearError: () => setError(null),
      startSignIn,
      requestEmailSignIn: requestEmailCode,
      verifyEmailSignIn: completeEmailSignIn,
      selectOrganization: changeOrganization,
      updatePortalPreferences,
      signOut
    }),
    [error, loading, sessionValue]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
