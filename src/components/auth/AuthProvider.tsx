"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
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
import { AlertTriangle, Figma, Github, Loader2, LogOut, PencilRuler, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BigBagLogo } from "@/components/BigBagLogo";
import { ThemeToggle } from "@/components/ThemeToggle";

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

let cachedRuntimeConfig: FirebaseOptions | null = null;

function resolveFirebaseConfig(runtimeConfig?: FirebaseOptions | null): FirebaseOptions | null {
  if (runtimeConfig?.apiKey && runtimeConfig?.authDomain && runtimeConfig?.projectId && runtimeConfig?.appId) {
    cachedRuntimeConfig = runtimeConfig;
    return runtimeConfig;
  }
  if (cachedRuntimeConfig) return cachedRuntimeConfig;
  if (configured) return firebaseConfig;
  return null;
}

function firebaseAuth(runtimeConfig?: FirebaseOptions | null) {
  if (getApps().length > 0) return getAuth(getApp());
  const config = resolveFirebaseConfig(runtimeConfig);
  if (!config) return null;
  const app = initializeApp(config);
  return getAuth(app);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => undefined;

    void (async () => {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
      const sessionPayload = (await sessionResponse?.json().catch(() => null)) as {
        ok?: boolean;
        data?: {
          authenticated?: boolean;
          configured?: boolean;
          firebase?: FirebaseOptions | null;
        };
      } | null;

      if (!active) return;

      const runtimeConfig = sessionPayload?.data?.firebase;
      const auth = firebaseAuth(runtimeConfig);

      if (!auth) {
        setStatus("misconfigured");
        return;
      }

      const hasServerSession = Boolean(sessionPayload?.data?.authenticated);
      void setPersistence(auth, browserLocalPersistence).catch(() => undefined);

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
          const payload = (await response.json()) as { ok?: boolean; error?: string };
          if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not create a secure session");
          if (active) setStatus("authenticated");
        } catch (sessionError) {
          if (!active) return;
          setError(sessionError instanceof Error ? sessionError.message : "Google sign-in failed");
          setStatus("unauthenticated");
        }
      });
    })();

    return () => {
      active = false;
      unsubscribe();
    };
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
    <main className="studio-auth relative min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <div className="studio-grid pointer-events-none absolute inset-0 opacity-55 dark:opacity-25" />

      <header className="relative z-10 mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12">
        <BigBagLogo size="lg" />
        <ThemeToggle />
      </header>

      <section className="relative z-10 mx-auto grid min-h-[calc(100dvh-5rem)] w-full max-w-7xl items-center gap-12 px-5 pb-12 pt-5 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] lg:px-12 lg:pb-20">
        <div className="max-w-2xl">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <span className="font-mono text-[10px] font-bold">&lt;/&gt;</span>
            </span>
            Your idea, built into a real product
          </div>
          <h1 className="max-w-xl text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Build something remarkable.
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
            Plan with an AI that understands the brief, shape the interface in a live workspace, and ship a working preview without losing the details that make it yours.
          </p>

          <ul className="mt-10 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Builder capabilities">
            {[
              { label: "Design", Icon: Figma, tone: "tool-figma" },
              { label: "Edit", Icon: PencilRuler, tone: "tool-edit" },
              { label: "Sync", Icon: Github, tone: "tool-github" },
              { label: "Publish", Icon: Rocket, tone: "tool-publish" },
            ].map(({ label, Icon, tone }) => (
              <li key={label} className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-3 shadow-sm">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></span>
                <span className="text-sm font-medium">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="justify-self-stretch lg:justify-self-end lg:w-full lg:max-w-[440px]">
          <div className="studio-auth-panel relative overflow-hidden rounded-[2rem] border border-border bg-card p-6 shadow-[0_32px_80px_-36px_rgba(26,24,46,0.45)] sm:p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-primary">Private workspace</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Start with your Google account</h2>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <span className="font-mono text-xs font-bold">&lt;/&gt;</span>
              </span>
            </div>

            <p className="mb-6 text-sm leading-6 text-foreground/70">
              Your projects, conversations, and previews stay attached to your identity so you can pick up exactly where you left off.
            </p>

            {status === "misconfigured" ? (
              <div className="flex gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 text-sm leading-6 text-amber-800 dark:text-amber-200" role="alert">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">Firebase setup is incomplete</p>
                  <p className="mt-0.5">Add the public Firebase configuration to enable secure Google sign-in.</p>
                </div>
              </div>
            ) : (
              <Button onClick={() => void onSignIn()} disabled={status === "loading"} className="h-12 w-full rounded-2xl bg-foreground text-sm font-semibold text-background shadow-lg transition-transform hover:bg-foreground/90 active:scale-[0.99]" variant="default">
                {status === "loading" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleMark className="mr-2 h-5 w-5" />}
                {status === "loading" ? "Connecting securely…" : "Continue with Google"}
              </Button>
            )}
            {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}

            <div className="mt-6 flex items-start gap-3 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[color:var(--studio-mint)]" />
              <p>Your Google identity is used only to isolate and restore your own projects.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function GoogleMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.37l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.92A6.01 6.01 0 0 1 6.08 12c0-.67.11-1.31.31-1.92V7.46H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.54l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.96 5.46l3.35 2.62C7.18 7.71 9.39 5.95 12 5.95Z" />
    </svg>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function UserAvatar({
  user,
  className = "h-8 w-8",
}: {
  user: User | null;
  className?: string;
}) {
  const label = user?.displayName || user?.email || "Account";
  const initials = label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return user?.photoURL ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className={`${className} rounded-full object-cover ring-2 ring-card`} />
  ) : (
    <span className={`${className} flex items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground ring-2 ring-card`} aria-hidden="true">
      {initials || "U"}
    </span>
  );
}

export function AuthUserMenu() {
  const { user, signOutUser } = useAuth();
  const label = user?.displayName || user?.email || "Account";
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => { void signOutUser().catch((signOutError) => {
        toast.error(signOutError instanceof Error ? signOutError.message : "Sign out failed");
      }); }}
      title={`Sign out ${label}`}
      className="h-10 gap-2.5 rounded-full border border-border bg-card px-1.5 pr-3 text-xs text-foreground shadow-sm hover:bg-accent"
    >
      <UserAvatar user={user} className="h-7 w-7" />
      <span className="hidden max-w-32 truncate sm:inline">{label}</span>
      <LogOut className="h-3.5 w-3.5" />
    </Button>
  );
}
