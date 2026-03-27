import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { AUTH_INVALID_EVENT } from "../../lib/api";
import {
  buildDingTalkAuthorizeUrl,
  createDingTalkSession,
  fetchDingTalkConfig,
  fetchWhoAmI,
  redirectTo,
  type AuthUser
} from "./api";

type AuthContextValue = {
  loading: boolean;
  user: AuthUser | null;
  error: string | null;
  reload: () => Promise<void>;
  startSignIn: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const DINGTALK_NONCE_KEY = "agent_studio_dingtalk_nonce";

function authErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "认证信息加载失败";
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWhoAmI();
      setUser(next.user);
    } catch (err) {
      setUser(null);
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onAuthInvalid = () => {
      setUser(null);
      setLoading(false);
      setError("登录状态已失效，请重新登录。");
    };

    async function bootstrap() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code")?.trim() || "";
      const state = params.get("state")?.trim() || "";
      if (code && state) {
        const nonce = window.sessionStorage.getItem(DINGTALK_NONCE_KEY) || "";
        try {
          const next = await createDingTalkSession({ code, state, nonce });
          setUser(next.user);
          setError(null);
        } catch (err) {
          setUser(null);
          setError(authErrorMessage(err));
        } finally {
          window.sessionStorage.removeItem(DINGTALK_NONCE_KEY);
          window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
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
      redirectTo(buildDingTalkAuthorizeUrl(config));
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      user,
      error,
      reload,
      startSignIn
    }),
    [error, loading, user]
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
