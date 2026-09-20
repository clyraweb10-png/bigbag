"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BigBagLogo } from "@/components/BigBagLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "next-themes";
import { CLOUDINARY_ASSETS } from "@/lib/cloudinary-assets";
import { getSupabaseClient } from "@/lib/supabase";
import { oauthCallbackUrl, resolveAppOrigin } from "@/lib/auth-redirect";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "misconfigured";

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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

function mapSupabaseUser(sbUser: SupabaseUser | null | undefined): AuthUser | null {
  if (!sbUser) return null;
  const displayName =
    (sbUser.user_metadata?.full_name as string) ||
    (sbUser.user_metadata?.name as string) ||
    sbUser.email?.split("@")[0] ||
    null;
  const photoURL =
    (sbUser.user_metadata?.avatar_url as string) ||
    (sbUser.user_metadata?.picture as string) ||
    null;
  return {
    id: sbUser.id,
    uid: sbUser.id,
    email: sbUser.email || null,
    displayName,
    photoURL,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
      const sessionPayload = (await sessionResponse?.json().catch(() => null)) as {
        ok?: boolean;
        data?: {
          authenticated?: boolean;
          configured?: boolean;
          supabase?: {
            url?: string;
            anonKey?: string;
          };
        };
      } | null;

      if (!active) return;

      if (sessionPayload?.data?.supabase?.url || sessionPayload?.data?.supabase?.anonKey) {
        const { configureRuntimeSupabase } = await import("@/lib/supabase");
        configureRuntimeSupabase(sessionPayload.data.supabase.url, sessionPayload.data.supabase.anonKey);
      }

      const supabase = getSupabaseClient();
      if (!supabase || !sessionPayload?.data?.configured) {
        setStatus("misconfigured");
        return;
      }

      const hasServerSession = Boolean(sessionPayload?.data?.authenticated);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!active) return;

        if (session?.user) {
          const authUser = mapSupabaseUser(session.user);
          setUser(authUser);
          setError(null);

          // Ensure HttpOnly server cookies are synced
          if (!hasServerSession) {
            await serializeSessionMutation(async () => {
              if (localStorage.getItem(SIGNING_OUT_KEY) !== null) return null;
              return fetch("/api/auth/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accessToken: session.access_token }),
              });
            });
          }
          if (active) setStatus("authenticated");
        } else {
          const signingOut = localStorage.getItem(SIGNING_OUT_KEY) !== null;
          setStatus(hasServerSession && !signingOut ? "authenticated" : "unauthenticated");
        }
      } catch (err) {
        if (!active) return;
        console.error("Failed to load Supabase auth session:", err);
        setStatus("unauthenticated");
      }
    })();

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;

      if (event === "SIGNED_OUT" || !session?.user) {
        setUser(null);
        setError(null);
        setStatus("unauthenticated");
        return;
      }

      if (localStorage.getItem(SIGNING_OUT_KEY) !== null) {
        setStatus("unauthenticated");
        return;
      }

      const mapped = mapSupabaseUser(session.user);
      setUser(mapped);
      setError(null);

      try {
        await serializeSessionMutation(async () => {
          if (localStorage.getItem(SIGNING_OUT_KEY) !== null) return null;
          return fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: session.access_token }),
          });
        });
        if (active) setStatus("authenticated");
      } catch (sessionError) {
        if (!active) return;
        setError(sessionError instanceof Error ? sessionError.message : "Session verification failed");
        setStatus("unauthenticated");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      const err = new Error("Supabase is not configured. Please check your Supabase environment settings.");
      setError(err.message);
      setStatus("misconfigured");
      throw err;
    }
    setError(null);
    setStatus("loading");
    try {
      localStorage.removeItem(SIGNING_OUT_KEY);
      const origin = resolveAppOrigin();
      try {
        sessionStorage.setItem("bigbag:auth:origin", origin);
      } catch {}
      const redirectTo = oauthCallbackUrl(origin);
      const { data, error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            access_type: "offline",
            prompt: "select_account",
          },
        },
      });
      if (signInError) throw signInError;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (signInError) {
      const msg = signInError instanceof Error ? signInError.message : "Google sign-in failed";
      setError(msg);
      setStatus("unauthenticated");
      throw signInError;
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setError(null);
    localStorage.setItem(SIGNING_OUT_KEY, String(Date.now()));
    try {
      await serializeSessionMutation(() => fetch("/api/auth/session", { method: "DELETE" }));
      const supabase = getSupabaseClient();
      if (supabase) await supabase.auth.signOut();
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
      {children}
    </AuthContext.Provider>
  );
}

export function SignInScreen({ status, error, onSignIn }: { status: AuthStatus; error: string | null; onSignIn: () => Promise<void> }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme !== "light" : true;
  const emblemBg = isDark ? "#252525" : "#ffffff";

  return (
    <main className="relative min-h-[100dvh] w-full overflow-hidden bg-white dark:bg-[#252525] text-zinc-900 dark:text-white flex flex-col justify-between select-none transition-colors duration-200">
      <div className="pointer-events-none absolute inset-0 overflow-hidden select-none">
        <div className="absolute inset-0 bg-white dark:bg-[#252525] transition-colors duration-200" />

        <div className="absolute -top-4 -left-12 sm:-left-6 md:left-[1%] lg:left-[2%] xl:left-[3%] w-[190px] sm:w-[240px] md:w-[270px] lg:w-[310px] rounded-2xl overflow-hidden shadow-xl shadow-zinc-900/5 dark:shadow-2xl dark:shadow-black/60 -rotate-[12deg] opacity-85 sm:opacity-90 md:opacity-95 lg:opacity-100 transition-all bg-white dark:bg-[#252525]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft1Light} alt="SaaS Analytics Dashboard" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft1Dark} alt="SaaS Analytics Dashboard" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        <div className="absolute top-[32%] -left-16 sm:-left-8 md:left-[0%] lg:left-[1%] xl:left-[2%] w-[180px] sm:w-[220px] md:w-[250px] lg:w-[290px] rounded-2xl overflow-hidden shadow-xl shadow-zinc-900/5 dark:shadow-2xl dark:shadow-black/60 -rotate-[15deg] opacity-85 sm:opacity-90 md:opacity-95 lg:opacity-100 transition-all bg-white dark:bg-[#252525]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft2Light} alt="E-Commerce Storefront" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft2Dark} alt="E-Commerce Storefront" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        <div className="absolute -bottom-6 -left-12 sm:-left-6 md:left-[1%] lg:left-[2%] xl:left-[3%] w-[190px] sm:w-[230px] md:w-[260px] lg:w-[300px] rounded-2xl overflow-hidden shadow-xl shadow-zinc-900/5 dark:shadow-2xl dark:shadow-black/60 -rotate-[8deg] opacity-85 sm:opacity-90 md:opacity-95 lg:opacity-100 transition-all bg-white dark:bg-[#252525]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft3Light} alt="AI Document Assistant" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft3Dark} alt="AI Document Assistant" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        <div className="absolute -top-4 -right-12 sm:-right-6 md:right-[1%] lg:right-[2%] xl:right-[3%] w-[190px] sm:w-[240px] md:w-[270px] lg:w-[310px] rounded-2xl overflow-hidden shadow-xl shadow-zinc-900/5 dark:shadow-2xl dark:shadow-black/60 rotate-[12deg] opacity-85 sm:opacity-90 md:opacity-95 lg:opacity-100 transition-all bg-white dark:bg-[#252525]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight1Light} alt="Modern SaaS Workspace" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight1Dark} alt="Modern SaaS Workspace" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        <div className="absolute top-[32%] -right-16 sm:-right-8 md:right-[0%] lg:right-[1%] xl:right-[2%] w-[180px] sm:w-[220px] md:w-[250px] lg:w-[290px] rounded-2xl overflow-hidden shadow-xl shadow-zinc-900/5 dark:shadow-2xl dark:shadow-black/60 rotate-[15deg] opacity-85 sm:opacity-90 md:opacity-95 lg:opacity-100 transition-all bg-white dark:bg-[#252525]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight2Light} alt="Mobile App Builder Interface" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight2Dark} alt="Mobile App Builder Interface" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        <div className="absolute -bottom-6 -right-12 sm:-right-6 md:right-[1%] lg:right-[2%] xl:right-[3%] w-[190px] sm:w-[230px] md:w-[260px] lg:w-[300px] rounded-2xl overflow-hidden shadow-xl shadow-zinc-900/5 dark:shadow-2xl dark:shadow-black/60 rotate-[8deg] opacity-85 sm:opacity-90 md:opacity-95 lg:opacity-100 transition-all bg-white dark:bg-[#252525]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight3Light} alt="Workflow Automation Canvas" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight3Dark} alt="Workflow Automation Canvas" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>
      </div>

      <header className="relative z-10 flex h-14 sm:h-16 w-full items-center justify-between px-4 sm:px-6 md:px-8 border-b border-zinc-200/60 dark:border-white/5">
        <BigBagLogo size="md" />
        <ThemeToggle showLabel={false} />
      </header>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-8 max-w-lg mx-auto w-full">
        <div
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center shadow-lg shadow-zinc-900/5 border border-zinc-200/80 dark:border-white/10 transition-colors mb-4"
          style={{ background: emblemBg }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={isDark ? "#ffffff" : "#19191f"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="7 8 3 12 7 16" />
            <line x1="14" y1="4" x2="10" y2="20" />
            <polyline points="17 8 21 12 17 16" />
          </svg>
        </div>

        <div className="text-center space-y-1 mt-2">
          <h1 className="text-2xl sm:text-3xl md:text-[34px] font-bold tracking-tight text-zinc-900 dark:text-white transition-colors">
            Turn ideas into products
          </h1>
          <p className="text-2xl sm:text-3xl md:text-[34px] font-bold tracking-tight text-zinc-900 dark:text-white transition-colors">
            From prompt <span className="text-emerald-600 dark:text-[#34d399]">to production</span>
          </p>
        </div>

        <div className="w-full max-w-[310px] sm:max-w-[340px] space-y-3 mt-7 flex flex-col items-center">
          {status === "misconfigured" ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs leading-5 text-amber-800 dark:text-amber-200" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
              <div>
                <p className="font-semibold">Supabase configuration missing</p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-300/80">Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment to enable Google sign-in.</p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void onSignIn()}
              disabled={status === "loading"}
              className="w-full h-11 sm:h-12 rounded-full colourless-glass font-semibold text-[14px] sm:text-[15px] flex items-center justify-center gap-2.5 active:scale-[0.99] transition-all disabled:opacity-60 cursor-pointer"
            >
              {status === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GoogleMark className="h-4 w-4 shrink-0" />
              )}
              <span>{status === "loading" ? "Connecting securely…" : "Continue with Google"}</span>
            </button>
          )}

          {error && (
            <p className="text-center text-xs text-red-500 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="mt-8 text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400 max-w-xs">
          By continuing, you agree to our{" "}
          <a href="#" className="underline underline-offset-2 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="underline underline-offset-2 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors">
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
  user: AuthUser | null;
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
