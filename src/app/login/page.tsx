"use client";

import { ArrowRight, Check, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { BigBagLogo } from "@/components/BigBagLogo";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const { signInWithGoogle } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setSubmitting(true); setError("");
    try { await signInWithGoogle(); }
    catch { setError("Google sign-in could not start. Check that this domain is authorized in Firebase."); }
    finally { setSubmitting(false); }
  }
  return <main className="min-h-screen bg-[#f7f7f5] text-[#181817] grid lg:grid-cols-[1.08fr_.92fr]">
    <section className="hidden lg:flex p-10 xl:p-16 flex-col justify-between bg-[#171715] text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_15%,#3dd6a2_0,transparent_32%),radial-gradient(circle_at_85%_85%,#6475ff_0,transparent_34%)]" />
      <BigBagLogo className="relative z-10" />
      <div className="relative z-10 max-w-xl"><p className="text-sm text-emerald-300 flex items-center gap-2 mb-5"><Sparkles className="size-4" /> From idea to working product</p><h1 className="text-5xl xl:text-6xl font-semibold tracking-[-.055em] leading-[.98]">Build software that already feels designed.</h1><div className="mt-9 grid gap-3 text-sm text-white/70">{["Responsive, production-ready interfaces", "Full-stack code with live previews", "Private projects and connected design tools"].map((item) => <p key={item} className="flex gap-3"><Check className="size-4 text-emerald-300 shrink-0" />{item}</p>)}</div></div>
      <p className="relative z-10 text-xs text-white/40">BigBag AI App Builder</p>
    </section>
    <section className="flex items-center justify-center p-6 sm:p-10"><div className="w-full max-w-md"><div className="lg:hidden mb-12"><BigBagLogo /></div><div className="size-11 rounded-2xl bg-white border shadow-sm grid place-items-center mb-7"><ShieldCheck className="size-5" /></div><h2 className="text-3xl font-semibold tracking-[-.035em]">Welcome to your workspace</h2><p className="mt-3 text-muted-foreground leading-6">Sign in to keep projects private, connect Figma, and continue building from any device.</p><Button onClick={() => void signIn()} disabled={submitting} size="lg" className="mt-8 w-full h-12 rounded-xl gap-3">{submitting ? <Loader2 className="size-4 animate-spin" /> : <span className="font-bold text-lg leading-none">G</span>}Continue with Google <ArrowRight className="size-4 ml-auto" /></Button>{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}<p className="mt-7 text-xs text-muted-foreground">Your Google password is never shared with BigBag.</p></div></section>
  </main>;
}
