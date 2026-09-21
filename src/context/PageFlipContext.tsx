"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";

interface PageFlipContextValue {
  isFlipped: boolean;
  isAnimating: boolean;
  flipToLogin: () => void;
  flipToFront: () => void;
  toggleFlip: () => void;
  returnPath: string;
}

const PageFlipContext = createContext<PageFlipContextValue | null>(null);

export function PageFlipProvider({
  children,
  initialFlipped = false,
}: {
  children: React.ReactNode;
  initialFlipped?: boolean;
}) {
  const pathname = usePathname();
  const [isFlipped, setIsFlipped] = useState(initialFlipped);
  const [isAnimating, setIsAnimating] = useState(false);
  const [returnPath, setReturnPath] = useState<string>("/");

  // Keep track of return path when on marketing pages
  useEffect(() => {
    if (pathname && pathname !== "/login") {
      setReturnPath(pathname);
    }
  }, [pathname]);

  const flipToLogin = useCallback(() => {
    if (isFlipped || isAnimating) return;
    setIsAnimating(true);
    setIsFlipped(true);

    // Update browser URL to /login without full page reload
    try {
      window.history.pushState({ flip: true }, "", "/login");
    } catch {}

    window.setTimeout(() => {
      setIsAnimating(false);
    }, 750);
  }, [isFlipped, isAnimating]);

  const flipToFront = useCallback(() => {
    if (!isFlipped || isAnimating) return;
    setIsAnimating(true);
    setIsFlipped(false);

    // Update browser URL back to landing or previous marketing page
    const target = returnPath || "/";
    try {
      window.history.pushState({ flip: false }, "", target);
    } catch {}

    window.setTimeout(() => {
      setIsAnimating(false);
    }, 750);
  }, [isFlipped, isAnimating, returnPath]);

  const toggleFlip = useCallback(() => {
    if (isFlipped) {
      flipToFront();
    } else {
      flipToLogin();
    }
  }, [isFlipped, flipToFront, flipToLogin]);

  // Handle browser back/forward buttons with animation
  useEffect(() => {
    const handlePopState = () => {
      setIsAnimating(true);
      if (window.location.pathname === "/login") {
        setIsFlipped(true);
      } else {
        setIsFlipped(false);
      }
      window.setTimeout(() => {
        setIsAnimating(false);
      }, 750);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Lock body scroll during flip animation
  useEffect(() => {
    if (isAnimating) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isAnimating]);

  return (
    <PageFlipContext.Provider
      value={{
        isFlipped,
        isAnimating,
        flipToLogin,
        flipToFront,
        toggleFlip,
        returnPath,
      }}
    >
      {children}
    </PageFlipContext.Provider>
  );
}

export function usePageFlip() {
  const context = useContext(PageFlipContext);
  if (!context) {
    // Graceful fallback if used outside provider
    return {
      isFlipped: false,
      isAnimating: false,
      flipToLogin: () => {},
      flipToFront: () => {},
      toggleFlip: () => {},
      returnPath: "/",
    };
  }
  return context;
}
