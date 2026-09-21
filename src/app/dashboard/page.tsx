"use client";

import { useEffect } from "react";
import { SkeletonDashboard } from "@/components/primitives";
import { DashboardContent } from "../page";
import { useAuth } from "@/components/auth/AuthProvider";
import { PageFlipProvider, usePageFlip } from "@/context/PageFlipContext";
import { PageFlip3D } from "@/components/transitions/PageFlip3D";
import { LoginView } from "@/components/auth/LoginView";
import { PortalTransitionProvider } from "@/components/transitions/PortalZoom";

function DashboardWithFlip() {
  const { status, user } = useAuth();
  const { isFlipped, flipToLogin, flipToFront } = usePageFlip();

  // If user becomes unauthenticated on /dashboard (e.g. signs out), flip to login
  useEffect(() => {
    if (status === "unauthenticated" && !isFlipped) {
      flipToLogin();
    } else if (status === "authenticated" && user && isFlipped) {
      flipToFront();
    }
  }, [status, user, isFlipped, flipToLogin, flipToFront]);

  return (
    <PageFlip3D
      front={<DashboardContent />}
      back={<LoginView onFlipBack={flipToFront} />}
    />
  );
}

export default function DashboardPage() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <SkeletonDashboard />;
  }

  const isUnauthenticated = status === "unauthenticated" || !user;

  return (
    <PortalTransitionProvider>
      <PageFlipProvider initialFlipped={isUnauthenticated}>
        <DashboardWithFlip />
      </PageFlipProvider>
    </PortalTransitionProvider>
  );
}
