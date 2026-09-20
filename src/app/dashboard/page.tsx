"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading dashboard</span>
      </div>
    );
  }

  return <DashboardContent />;
}
