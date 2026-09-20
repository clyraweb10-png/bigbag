"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SkeletonDashboard } from "@/components/primitives";
import { DashboardContent } from "../page";
import { useAuth } from "@/components/auth/AuthProvider";

export default function DashboardPage() {
  const router = useRouter();
  const { status, user } = useAuth();

  useEffect(() => {
    if (status !== "loading" && (status !== "authenticated" || !user)) {
      router.replace("/login?next=%2Fdashboard");
    }
  }, [router, status, user]);

  if (status !== "authenticated" || !user) {
    return <SkeletonDashboard />;
  }

  return <DashboardContent />;
}
