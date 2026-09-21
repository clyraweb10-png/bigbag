"use client";

import React, { useState, useEffect, useCallback, createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type TransitionDirection = "forward" | "backward";

const STORAGE_KEY = "bigbag:portal-direction";

interface PortalTransitionContextValue {
  navigateWithPortal: (url: string, direction?: TransitionDirection) => void;
  isNavigating: boolean;
  navDirection: TransitionDirection | null;
}

const PortalTransitionContext = createContext<PortalTransitionContextValue | null>(null);

export function PortalTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const [navDirection, setNavDirection] = useState<TransitionDirection | null>(null);

  const navigateWithPortal = useCallback(
    (url: string, direction: TransitionDirection = "forward") => {
      if (isNavigating) return;
      setIsNavigating(true);
      setNavDirection(direction);

      try {
        sessionStorage.setItem(STORAGE_KEY, direction);
      } catch {}

      window.setTimeout(() => {
        router.push(url);
        window.setTimeout(() => {
          setIsNavigating(false);
          setNavDirection(null);
        }, 150);
      }, 260);
    },
    [isNavigating, router]
  );

  return (
    <PortalTransitionContext.Provider
      value={{
        navigateWithPortal,
        isNavigating,
        navDirection,
      }}
    >
      {children}
    </PortalTransitionContext.Provider>
  );
}

export function usePortalTransition() {
  const context = useContext(PortalTransitionContext);
  const router = useRouter();

  if (!context) {
    return {
      navigateWithPortal: (url: string) => router.push(url),
      isNavigating: false,
      navDirection: null,
    };
  }
  return context;
}

interface PortalZoomContainerProps {
  children: React.ReactNode;
  pageType: "dashboard" | "generate";
  className?: string;
}

export function PortalZoomContainer({
  children,
  pageType,
  className = "",
}: PortalZoomContainerProps) {
  const { isNavigating, navDirection } = usePortalTransition();
  const [mounted, setMounted] = useState(false);
  const [entryDirection, setEntryDirection] = useState<TransitionDirection>("forward");

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY) as TransitionDirection | null;
      if (stored) {
        setEntryDirection(stored);
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
    setMounted(true);
  }, []);

  // Determine initial state based on entry direction and page type
  const getInitial = () => {
    if (!mounted) return { opacity: 1, scale: 1, filter: "blur(0px)", y: 0 };
    if (pageType === "generate") {
      // Entering generation: zoom forward from slightly scaled up or center depth
      return {
        opacity: 0,
        scale: 1.05,
        filter: "blur(8px)",
        y: 8,
      };
    } else {
      // Returning to dashboard: zoom forward from depth
      if (entryDirection === "backward") {
        return {
          opacity: 0,
          scale: 0.94,
          filter: "blur(6px)",
          y: -8,
        };
      }
      return { opacity: 1, scale: 1, filter: "blur(0px)", y: 0 };
    }
  };

  // Determine exit animation when navigating
  const getExit = () => {
    if (!isNavigating) return { opacity: 1, scale: 1, filter: "blur(0px)", y: 0 };
    if (navDirection === "forward") {
      // Dashboard zooming back into depth as we leave for generation
      return {
        opacity: 0,
        scale: 0.93,
        filter: "blur(6px)",
        y: -10,
      };
    } else {
      // Generation zooming forward and fading as we return to dashboard
      return {
        opacity: 0,
        scale: 1.05,
        filter: "blur(8px)",
        y: 10,
      };
    }
  };

  return (
    <motion.div
      className={cn("w-full min-h-screen relative", className)}
      initial={getInitial()}
      animate={isNavigating ? getExit() : { opacity: 1, scale: 1, filter: "blur(0px)", y: 0 }}
      transition={{
        duration: isNavigating ? 0.26 : 0.38,
        ease: [0.22, 1, 0.36, 1], // Velvety smooth modern cubic-bezier curve
      }}
    >
      {children}

      {/* Luminous energy sweep on generation entry */}
      {pageType === "generate" && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 h-[3px] z-50 bg-gradient-to-r from-transparent via-[#18a981] to-transparent shadow-[0_0_12px_rgba(24,169,129,0.8)]"
          initial={{ opacity: 0, scaleX: 0.2 }}
          animate={{ opacity: [0, 1, 0], scaleX: [0.2, 1, 1] }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      )}
    </motion.div>
  );
}
