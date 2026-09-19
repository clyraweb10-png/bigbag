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
import { AlertTriangle, Loader2, LogOut } from "lucide-react";
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
    <main className="relative min-h-[100dvh] w-full overflow-hidden bg-[#000000] text-white flex flex-col justify-between select-none">
      {/* ═══ BACKGROUND VIDEO ONLY ═══ */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden bg-black">
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="h-full w-full object-cover opacity-80"
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260319_055001_8e16d972-3b2b-441c-86ad-2901a54682f9.mp4"
        />
        {/* Soft center vignette gradient for text contrast */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_65%_65%_at_50%_50%,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.45)_55%,rgba(0,0,0,0.2)_100%)]" />
      </div>

      {/* ═══ TOP HEADER ═══ */}
      <header className="relative z-30 flex h-16 sm:h-20 w-full items-center justify-between px-6 sm:px-10">
        <div className="flex items-center gap-2">
          <BigBagLogo size="md" href={null} className="text-white" />
        </div>
        <ThemeToggle />
      </header>

      {/* ═══ CENTER AUTH HERO ═══ */}
      <div className="relative z-20 flex flex-1 flex-col items-center justify-center px-4 pb-12 pt-2 sm:pb-16">
        {/* 3D Rotating Emblem iframe */}
        <div className="w-[180px] h-[130px] sm:w-[210px] sm:h-[150px] relative flex items-center justify-center -mb-2">
          <iframe
            src="/bigbag-3d-emblem.html"
            className="w-full h-full border-0 bg-transparent"
            title="3D Bigbag Rotating Emblem"
          />
        </div>

        {/* Headline */}
        <div className="text-center space-y-1 mt-2">
          <h1 className="text-2xl sm:text-3xl md:text-[34px] font-bold tracking-tight text-white">
            Turn ideas into products
          </h1>
          <p className="text-2xl sm:text-3xl md:text-[34px] font-bold tracking-tight text-white">
            From prompt <span className="text-[#34d399]">to production</span>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="w-full max-w-[310px] sm:max-w-[340px] space-y-3 mt-7 flex flex-col items-center">
          {status === "misconfigured" ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs leading-5 text-amber-200" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div>
                <p className="font-semibold">Firebase configuration missing</p>
                <p className="mt-0.5 text-amber-300/80">Configure Firebase variables in .env.local to enable Google sign-in.</p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void onSignIn()}
              disabled={status === "loading"}
              className="w-full h-11 sm:h-12 rounded-full bg-white text-black font-semibold text-[14px] sm:text-[15px] flex items-center justify-center gap-2.5 shadow-lg shadow-white/5 hover:bg-zinc-100 active:scale-[0.99] transition-all disabled:opacity-60 cursor-pointer"
            >
              {status === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin text-black" />
              ) : (
                <GoogleMark className="h-4 w-4 shrink-0" />
              )}
              <span>{status === "loading" ? "Connecting securely…" : "Continue with Google"}</span>
            </button>
          )}

          {error && (
            <p className="text-center text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Footer Legal notice */}
        <div className="mt-8 text-center text-[11px] leading-relaxed text-zinc-500 max-w-xs">
          By continuing, you agree to our{" "}
          <a href="#" className="underline underline-offset-2 text-zinc-400 hover:text-zinc-200 transition-colors">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="underline underline-offset-2 text-zinc-400 hover:text-zinc-200 transition-colors">
            Privacy Policy
          </a>
          .
        </div>
      </div>
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
