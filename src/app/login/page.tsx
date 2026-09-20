"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { BigBagLogo } from "@/components/BigBagLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Loader2, AlertTriangle } from "lucide-react";
import { SkeletonDashboard } from "@/components/primitives";
import { CLOUDINARY_ASSETS } from "@/lib/cloudinary-assets";
import { useTheme } from "next-themes";
import { safeAuthReturnPath } from "@/lib/auth-redirect";

/* ─── Google "G" logo SVG ─── */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { user, status, error, signIn } = useAuth();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [signing, setSigning] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const params = new URLSearchParams(window.location.search);
      const urlErr = params.get("error") || params.get("error_description");
      if (urlErr) {
        setLocalError(decodeURIComponent(urlErr));
      }
    } catch {}
  }, []);

  // Ensure button loading spinner never remains stuck
  useEffect(() => {
    if (status !== "loading") {
      setSigning(false);
    }
  }, [status]);

  /* ── Redirect after successful sign-in ── */
  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    try {
      const requestedPath = safeAuthReturnPath(
        new URLSearchParams(window.location.search).get("next"),
        ""
      );
      if (requestedPath) {
        router.replace(requestedPath);
        return;
      }
      const pending = sessionStorage.getItem("bigbag:pending-prompt");
      if (pending) {
        sessionStorage.removeItem("bigbag:pending-prompt");
        router.replace(`/generate?prompt=${encodeURIComponent(pending)}`);
      } else {
        router.replace("/dashboard");
      }
    } catch {
      router.replace("/dashboard");
    }
  }, [status, user, router]);

  const isDark = mounted ? resolvedTheme !== "light" : true;

  const handleSignIn = async () => {
    setLocalError(null);
    setSigning(true);
    try {
      await signIn();
    } catch (err) {
      setSigning(false);
      setLocalError(err instanceof Error ? err.message : "Failed to sign in with Google");
    }
  };

  /* While loading or after auth, show preloader screen */
  if (status === "authenticated" && user) {
    return <SkeletonDashboard />;
  }

  return (
    <main className="relative min-h-[100dvh] w-full overflow-hidden bg-white dark:bg-[#1d1d1c] text-zinc-900 dark:text-white flex flex-col justify-between select-none transition-colors duration-200">

      {/* ─── Floating mockup cards ─── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-white dark:bg-[#1d1d1c] transition-colors duration-200" />

        {/* Left top */}
        <div className="absolute -top-4 -left-12 sm:-left-6 md:left-[1%] lg:left-[2%] w-[190px] sm:w-[240px] md:w-[270px] lg:w-[310px] rounded-2xl overflow-hidden shadow-xl -rotate-[12deg] opacity-85 sm:opacity-90 md:opacity-95 transition-all">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft1Light} alt="" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft1Dark} alt="" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        {/* Left middle */}
        <div className="absolute top-[32%] -left-16 sm:-left-8 md:left-[0%] lg:left-[1%] w-[180px] sm:w-[220px] md:w-[250px] lg:w-[290px] rounded-2xl overflow-hidden shadow-xl -rotate-[15deg] opacity-85 sm:opacity-90 md:opacity-95 transition-all">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft2Light} alt="" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft2Dark} alt="" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        {/* Left bottom */}
        <div className="absolute -bottom-8 -left-10 sm:-left-4 md:left-[2%] lg:left-[3%] w-[170px] sm:w-[210px] md:w-[240px] lg:w-[280px] rounded-2xl overflow-hidden shadow-xl -rotate-[8deg] opacity-85 sm:opacity-90 md:opacity-95 transition-all">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft3Light} alt="" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardLeft3Dark} alt="" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        {/* Right top */}
        <div className="absolute -top-4 -right-12 sm:-right-6 md:right-[1%] lg:right-[2%] w-[190px] sm:w-[240px] md:w-[270px] lg:w-[310px] rounded-2xl overflow-hidden shadow-xl rotate-[14deg] opacity-85 sm:opacity-90 md:opacity-95 transition-all">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight1Light} alt="" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight1Dark} alt="" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        {/* Right middle */}
        <div className="absolute top-[32%] -right-16 sm:-right-8 md:right-[0%] lg:right-[1%] w-[180px] sm:w-[220px] md:w-[250px] lg:w-[290px] rounded-2xl overflow-hidden shadow-xl rotate-[18deg] opacity-85 sm:opacity-90 md:opacity-95 transition-all">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight2Light} alt="" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight2Dark} alt="" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>

        {/* Right bottom */}
        <div className="absolute -bottom-8 -right-10 sm:-right-4 md:right-[2%] lg:right-[3%] w-[170px] sm:w-[210px] md:w-[240px] lg:w-[280px] rounded-2xl overflow-hidden shadow-xl rotate-[10deg] opacity-85 sm:opacity-90 md:opacity-95 transition-all">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight3Light} alt="" className="w-full h-auto object-cover rounded-2xl border border-zinc-200/80 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CLOUDINARY_ASSETS.cardRight3Dark} alt="" className="w-full h-auto object-cover rounded-2xl border border-white/10 hidden dark:block" />
        </div>
      </div>

      {/* ─── Top bar ─── */}
      <div className="relative z-10 flex items-center justify-between px-5 py-4">
        <BigBagLogo size="md" href="/" />
        <ThemeToggle showLabel={false} />
      </div>

      {/* ─── Center card ─── */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm mx-auto text-center">
          {/* Logo emblem */}
          <div
            className="mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center border border-zinc-200/80 dark:border-white/10 shadow-lg"
            style={{ background: isDark ? "#1d1d1c" : "#ffffff" }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={isDark ? "#ffffff" : "#19191f"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7 8 3 12 7 16" />
              <line x1="14" y1="4" x2="10" y2="20" />
              <polyline points="17 8 21 12 17 16" />
            </svg>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-white mb-1">
            Turn ideas into products
          </h1>
          <p className="text-base text-zinc-500 dark:text-zinc-400 mb-7">
            From prompt{" "}
            <span className="text-[#18a981] font-semibold">to production</span>
          </p>

          {/* Misconfiguration or Error */}
          {status === "misconfigured" ? (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 text-left">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
              <div>
                <p className="font-semibold">Supabase Not Configured</p>
                <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">
                  Please verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your deployment environment.
                </p>
              </div>
            </div>
          ) : (localError || error) ? (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400 text-left">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{localError || error}</span>
            </div>
          ) : null}

          {/* Google sign-in */}
          <button
            onClick={handleSignIn}
            disabled={signing || status === "loading"}
            className="w-full flex items-center justify-center gap-3 rounded-full border border-zinc-200 dark:border-white/20 bg-white dark:bg-white/5 hover:bg-zinc-50 dark:hover:bg-white/10 px-5 py-3 text-sm font-semibold text-zinc-800 dark:text-white shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {signing || status === "loading" ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            {signing ? "Signing in…" : "Continue with Google"}
          </button>

          {/* Terms */}
          <p className="mt-5 text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
            By continuing, you agree to our{" "}
            <a href="/terms" className="underline hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="underline hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>

      {/* ─── Bottom spacer ─── */}
      <div className="h-12" />
    </main>
  );
}
