"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PageFlipProvider, usePageFlip } from "@/context/PageFlipContext";
import { PageFlip3D } from "@/components/transitions/PageFlip3D";
import { LandingPageMarketing } from "@/components/marketing/LandingPage";
import { DashboardContent } from "../page";
import { LoginView } from "@/components/auth/LoginView";
import { PortalTransitionProvider } from "@/components/transitions/PortalZoom";

function LoginPageFlipContent() {
  const { status, user } = useAuth();
  const { isFlipped, flipToFront } = usePageFlip();

  // If user becomes authenticated on /login, smoothly flip to dashboard
  useEffect(() => {
    if (status === "authenticated" && user && isFlipped) {
      flipToFront();
    }
  }, [status, user, isFlipped, flipToFront]);

  const isAuthenticated = status === "authenticated" && !!user;

  return (
    <PageFlip3D
      front={isAuthenticated ? <DashboardContent /> : <LandingPageMarketing />}
      back={<LoginView onFlipBack={flipToFront} />}
    />
  );
}

export default function LoginPage() {
  const { status, user } = useAuth();
  const isAuthenticated = status === "authenticated" && !!user;

  return (
    <PortalTransitionProvider>
      <PageFlipProvider initialFlipped={!isAuthenticated}>
        <LoginPageFlipContent />
      </PageFlipProvider>
    </PortalTransitionProvider>
  );
}
