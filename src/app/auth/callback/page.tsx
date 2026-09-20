"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient, configureRuntimeSupabase } from "@/lib/supabase";
import { BigBagLogo } from "@/components/BigBagLogo";
import { Loader2 } from "lucide-react";
import { safeAuthReturnPath } from "@/lib/auth-redirect";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function handleAuth() {
      try {
        const search = window.location.search;
        const hash = window.location.hash;
        const searchParams = new URLSearchParams(search);

        // 1. Check for OAuth errors in search params or hash
        let oauthError = searchParams.get("error_description") || searchParams.get("error");
        if (!oauthError && hash.includes("error_description")) {
          const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
          oauthError = hashParams.get("error_description") || hashParams.get("error");
        }
        if (oauthError) {
          router.replace(`/login?error=${encodeURIComponent(oauthError)}`);
          return;
        }

        // 2. Fetch session configuration from server to ensure runtime keys are present
        const sessionMetaRes = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
        const sessionMeta = (await sessionMetaRes?.json().catch(() => null)) as {
          ok?: boolean;
          data?: {
            supabase?: { url?: string; anonKey?: string };
          };
        } | null;

        if (sessionMeta?.data?.supabase) {
          configureRuntimeSupabase(sessionMeta.data.supabase.url, sessionMeta.data.supabase.anonKey);
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
          router.replace(`/login?error=${encodeURIComponent("Authentication provider could not be initialized")}`);
          return;
        }

        // 3. If an authorization code was returned (PKCE flow), exchange it
        const code = searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.error("Code exchange failed:", exchangeError);
          }
        }

        // 4. Function to sync session with BigBag server cookies
        const syncSession = async (accessToken: string) => {
          const res = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken }),
          });
          const payload = (await res.json().catch(() => null)) as { ok?: boolean } | null;
          if (payload?.ok) {
            const next = safeAuthReturnPath(searchParams.get("next"), "");
            if (next) {
              router.replace(next);
              return;
            }
            const pending = sessionStorage.getItem("bigbag:pending-prompt");
            if (pending) {
              sessionStorage.removeItem("bigbag:pending-prompt");
              router.replace(`/generate?prompt=${encodeURIComponent(pending)}`);
            } else {
              router.replace("/dashboard");
            }
            return true;
          }
          return false;
        };

        // 5. Try getSession immediately
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const ok = await syncSession(session.access_token);
          if (ok) return;
        }

        // 6. Listen for auth state change if session is being processed asynchronously
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
          if (!active) return;
          if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && currentSession?.access_token) {
            subscription.unsubscribe();
            await syncSession(currentSession.access_token);
          }
        });

        // 7. Timeout guard (10 seconds)
        const timeout = setTimeout(() => {
          if (!active) return;
          subscription.unsubscribe();
          router.replace(`/login?error=${encodeURIComponent("Sign-in verification timed out. Please try again.")}`);
        }, 10000);

        return () => {
          clearTimeout(timeout);
          subscription.unsubscribe();
        };
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : "Authentication failed";
        setErrorMessage(msg);
        router.replace(`/login?error=${encodeURIComponent(msg)}`);
      }
    }

    void handleAuth();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center bg-white dark:bg-[#1d1d1c] text-zinc-900 dark:text-white px-4 select-none">
      <div className="w-full max-w-sm mx-auto text-center flex flex-col items-center">
        <div className="mb-6">
          <BigBagLogo size="md" href="/" />
        </div>

        <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-white/5 border border-zinc-200/80 dark:border-white/10 flex items-center justify-center mb-4 shadow-sm">
          <Loader2 className="w-6 h-6 animate-spin text-[#18a981]" />
        </div>

        <h1 className="text-xl font-bold tracking-tight mb-2">
          Completing sign-in…
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {errorMessage || "Securing your workspace session"}
        </p>
      </div>
    </main>
  );
}
