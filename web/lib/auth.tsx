"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

const STORAGE_KEY = "garagebot_session_token";

type AuthState = {
  token: string | null;
  waId: string | null;
  userId: string | null;
  ready: boolean; // false until we've checked localStorage + validated the token once
  login: (token: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const logoutMutation = useMutation(api.auth.logout);

  useEffect(() => {
    setToken(localStorage.getItem(STORAGE_KEY));
    setHydrated(true);
  }, []);

  // "skip" until hydrated so we don't validate a null token against the server.
  const session = useQuery(api.auth.me, hydrated && token ? { token } : "skip");

  useEffect(() => {
    // Token was set but the server says it's invalid/expired — clear it.
    if (hydrated && token && session === null) {
      localStorage.removeItem(STORAGE_KEY);
      setToken(null);
    }
  }, [hydrated, token, session]);

  function login(newToken: string) {
    localStorage.setItem(STORAGE_KEY, newToken);
    setToken(newToken);
  }

  function logout() {
    if (token) void logoutMutation({ token });
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
  }

  const ready = hydrated && (!token || session !== undefined);

  return (
    <AuthContext.Provider
      value={{
        token,
        waId: session?.waId ?? null,
        userId: session?.userId ?? null,
        ready,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Wrap any dashboard page in this to require a valid session, redirecting
// to /login otherwise. Renders nothing until the auth check settles, so
// there's no flash of protected content.
export function AuthGuard({ children }: { children: ReactNode }) {
  const { ready, token, userId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && (!token || userId === null)) {
      router.replace("/login");
    }
  }, [ready, token, userId, router]);

  if (!ready || !token || userId === null) return null;
  return <>{children}</>;
}
