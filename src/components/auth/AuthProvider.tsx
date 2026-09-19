"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { Loader2, LogIn, LogOut, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BigBagLogo } from "@/components/BigBagLogo";

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "misconfigured";

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  error: string | null;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const configured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId
);
const SIGNING_OUT_KEY = "bigbag:auth:signing-out";
const SESSION_MUTATION_LOCK = "bigbag:auth:session-mutation";
let fallbackSessionMutation: Promise<unknown> = Promise.resolve();

async function serializeSessionMutation<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(SESSION_MUTATION_LOCK, operation);
  }
  const result = fallbackSessionMutation.then(operation, operation);
  fallbackSessionMutation = result.then(() => undefined, () => undefined);
  return result;
}

function firebaseAuth() {
  if (!configured) return null;
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(configured ? "loading" : "misconfigured");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = firebaseAuth();
    if (!auth) return;
    let active = true;
    let unsubscribe = () => undefined;

    void setPersistence(auth, browserLocalPersistence).catch(() => undefined);
    void (async () => {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
      const hasServerSession = Boolean(sessionResponse?.ok);
      if (!active) return;

      unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
        if (!active) return;
        setUser(nextUser);
        setError(null);
        if (!nextUser) {
          const signingOut = localStorage.getItem(SIGNING_OUT_KEY) !== null;
          setStatus(hasServerSession && !signingOut ? "authenticated" : "unauthenticated");
          return;
        }
        if (localStorage.getItem(SIGNING_OUT_KEY) !== null) {
          setStatus("unauthenticated");
          return;
        }
        setStatus("loading");
        try {
          const idToken = await nextUser.getIdToken();
          const response = await serializeSessionMutation(async () => {
            if (localStorage.getItem(SIGNING_OUT_KEY) !== null) return null;
            return fetch("/api/auth/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idToken }),
            });
          });
          if (!response) {
            if (active) setStatus("unauthenticated");
            return;
          }
          const payload = await response.json() as { ok?: boolean; error?: string };
          if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not create a secure session");
          if (active) setStatus("authenticated");
        } catch (sessionError) {
          if (!active) return;
          setError(sessionError instanceof Error ? sessionError.message : "Google sign-in failed");
          setStatus("unauthenticated");
        }
      });
    })();

    return () => { active = false; unsubscribe(); };
  }, []);

  const signIn = useCallback(async () => {
    const auth = firebaseAuth();
    if (!auth) return;
    setError(null);
    setStatus("loading");
    try {
      localStorage.removeItem(SIGNING_OUT_KEY);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Google sign-in failed");
      setStatus("unauthenticated");
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setError(null);
    localStorage.setItem(SIGNING_OUT_KEY, String(Date.now()));
    try {
      const response = await serializeSessionMutation(() => fetch("/api/auth/session", { method: "DELETE" }));
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not end the server session");
      const auth = firebaseAuth();
      if (auth) await signOut(auth);
      setUser(null);
      setStatus("unauthenticated");
    } catch (signOutError) {
      localStorage.removeItem(SIGNING_OUT_KEY);
      const message = signOutError instanceof Error ? signOutError.message : "Sign out failed";
      setError(message);
      throw signOutError;
    }
  }, []);

  const value = useMemo(() => ({ user, status, error, signIn, signOutUser }), [user, status, error, signIn, signOutUser]);

  return (
    <AuthContext.Provider value={value}>
      {status === "authenticated" ? children : <SignInScreen status={status} error={error} onSignIn={signIn} />}
    </AuthContext.Provider>
  );
}

function SignInScreen({ status, error, onSignIn }: { status: AuthStatus; error: string | null; onSignIn: () => Promise<void> }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 text-foreground">
      <div className="pointer-events-none absolute left-1/2 top-[-15%] h-[480px] w-[760px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <section className="relative w-full max-w-md rounded-3xl border border-border/80 bg-card/90 p-7 shadow-2xl backdrop-blur-xl sm:p-9">
        <div className="mb-8 flex justify-center"><BigBagLogo size="lg" /></div>
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="h-6 w-6" /></div>
          <h1 className="text-2xl font-semibold tracking-tight">Build something remarkable</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Sign in to keep your projects private, plan your idea, and generate a working preview.</p>
        </div>
        {status === "misconfigured" ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">Firebase public configuration is missing.</div>
        ) : (
          <Button onClick={() => void onSignIn()} disabled={status === "loading"} className="h-11 w-full rounded-xl text-sm" variant="glow">
            {status === "loading" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
            {status === "loading" ? "Connecting securely…" : "Continue with Google"}
          </Button>
        )}
        {error && <p className="mt-3 text-center text-xs text-destructive">{error}</p>}
        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">Your Google identity is used only to isolate and restore your own projects.</p>
      </section>
    </main>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthUserMenu() {
  const { user, signOutUser } = useAuth();
  const label = user?.displayName || user?.email || "Account";
  const initials = label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => { void signOutUser().catch((signOutError) => {
        toast.error(signOutError instanceof Error ? signOutError.message : "Sign out failed");
      }); }}
      title={`Sign out ${label}`}
      className="h-8 gap-2 rounded-lg px-2 text-xs text-muted-foreground"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{initials || "U"}</span>
      <span className="hidden max-w-32 truncate sm:inline">{label}</span>
      <LogOut className="h-3.5 w-3.5" />
    </Button>
  );
}
