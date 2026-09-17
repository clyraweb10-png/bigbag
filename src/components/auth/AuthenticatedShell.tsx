"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "./AuthProvider";

const PUBLIC_PATHS = new Set(["/login"]);

export function AuthenticatedShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    if (user && pathname === "/login") router.replace("/");
  }, [isPublic, loading, pathname, router, user]);

  if (loading || (!user && !isPublic) || (user && pathname === "/login")) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" /> Securing your workspace…
        </div>
      </div>
    );
  }
  return children;
}
