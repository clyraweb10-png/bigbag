"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient, configureRuntimeSupabase } from "@/lib/supabase";
import { BigBagLogo } from "@/components/BigBagLogo";
import { Loader2 } from "lucide-react";
import { safeAuthReturnPath, resolveAppOrigin } from "@/lib/auth-redirect";

// The canonical destination after auth.
// - In production: resolveAppOrigin() returns NEXT_PUBLIC_APP_URL (https://vibecode-spzy.onrender.com)
// - In development: resolveAppOrigin() preserves http://localhost:3000
function getAuthDestination(searchParams: URLSearchParams): string {
  const next = safeAuthReturnPath(searchParams.get("next"), "");
  if (next) return next;
  try {
    const pending = sessionStorage.getItem("bigbag:pending-prompt");
    if (pending) {
      sessionStorage.removeItem("bigbag:pending-prompt");
      return `/generate?prompt=${encodeURIComponent(pending)}`;
    }
  } catch {}
  return "/dashboard";
}

export default function AuthCallbackPage() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function handleAuth() {
      try {
        const searchParams = new URLSearchParams(window.location.search);
        const hash = window.location.hash;

        // 1. Surface OAuth errors immediately
        let oauthError =
          searchParams.get("error_description") || searchParams.get("error");
        if (!oauthError && hash.includes("error_description")) {
          const hp = new URLSearchParams(hash.replace(/^#/, ""));
          oauthError = hp.get("error_description") || hp.get("error");
        }
        if (oauthError) {
          const origin = resolveAppOrigin();
          window.location.replace(`${origin}/login?error=${encodeURIComponent(oauthError)}`);
          return;
        }

        // 2. Ensure Supabase runtime config is loaded from the server
        const sessionMetaRes = await fetch("/api/auth/session", {
          cache: "no-store",
        }).catch(() => null);
        const sessionMeta = (await sessionMetaRes?.json().catch(() => null)) as {
          ok?: boolean;
          data?: { supabase?: { url?: string; anonKey?: string } };
        } | null;

        if (sessionMeta?.data?.supabase) {
          configureRuntimeSupabase(
            sessionMeta.data.supabase.url,
            sessionMeta.data.supabase.anonKey
          );
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
          const origin = resolveAppOrigin();
          window.location.replace(
            `${origin}/login?error=${encodeURIComponent("Authentication provider could not be initialized")}`
          );
          return;
        }

        // 3. Exchange the authorization code for a session.
        //    This MUST happen on the client so Supabase can read the
        //    code_verifier it stored in localStorage during signInWithOAuth.
        const code = searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.warn("Client code exchange error:", exchangeError.message);
            // Don't bail — getSession() below may still have a valid session
            // if an earlier exchange succeeded.
          }
        }

        // 4. Helper: POST the access_token to our server to set the HttpOnly
        //    session cookie, then hard-navigate to the destination.
        const completeAuth = async (accessToken: string): Promise<boolean> => {
          const res = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken }),
          });
          const payload = (await res.json().catch(() => null)) as {
            ok?: boolean;
          } | null;

          if (payload?.ok) {
            const destination = getAuthDestination(searchParams);
            const origin = resolveAppOrigin();
            window.location.href = `${origin}${destination}`;
            return true;
          }
          return false;
        };

        // 5. Try to get the session immediately (exchange above may have set it)
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.access_token) {
          if (!active) return;
          const ok = await completeAuth(session.access_token);
          if (ok) return;
        }

        // 6. Listen for the SIGNED_IN event in case exchange is still in flight
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
          if (!active) return;
          if (
            (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
            currentSession?.access_token
          ) {
            subscription.unsubscribe();
            await completeAuth(currentSession.access_token);
          }
        });

        // 7. Timeout guard — if nothing happens in 12 s, something went wrong
        const timeout = setTimeout(() => {
          if (!active) return;
          subscription.unsubscribe();
          const origin = resolveAppOrigin();
          window.location.replace(
            `${origin}/login?error=${encodeURIComponent(
              "Sign-in timed out. Please try again."
            )}`
          );
        }, 12000);

        return () => {
          clearTimeout(timeout);
          subscription.unsubscribe();
        };
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : "Authentication failed";
        setErrorMessage(msg);
        const origin = resolveAppOrigin();
        window.location.replace(
          `${origin}/login?error=${encodeURIComponent(msg)}`
        );
      }
    }

    void handleAuth();
    return () => {
      active = false;
    };
  }, []);

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
