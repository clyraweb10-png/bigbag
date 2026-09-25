// src/app/layout.tsx
import React from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { GlobalErrorCatcher } from "@/components/GlobalErrorCatcher";
import { Toaster } from "@/components/ui/sonner";
import { InsufficientCreditsModal } from "@/components/workspace/InsufficientCreditsModal";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/auth/AuthProvider";

const dmSans = localFont({ src: "./fonts/DMSans.ttf", variable: "--font-dm-sans", weight: "300 700", display: "swap" });
const geistMono = localFont({ src: "./fonts/GeistMono.ttf", variable: "--font-geist-mono", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: "BigBag — </> AI App Builder",
  description: "Build modern full-stack apps with BigBag AI. Describe your idea, preview in real-time, and deploy with one click.",
};

// SUPER IMPORTANT: NOT EDIT THE FOLLOWING 2 LINES TO FORCE NEXT.JS TO RENDER DYNAMICALLY
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthProvider>
          <GlobalErrorCatcher />
          <Toaster position="top-right" richColors />
          {/*
            ⭐ MOUNTED ONCE FOR THE WHOLE APP. Running out of credits can happen on any
            screen — the dashboard creating a project, the workspace publishing one — and
            the modal listens for the event the VCaaS client raises rather than being wired
            per page. See `InsufficientCreditsModal`.
          */}
          <InsufficientCreditsModal />
          <div className="min-h-screen flex flex-col bg-background text-foreground transition-colors duration-200">
            <main className="flex-1 flex flex-col">{children}</main>
          </div>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
