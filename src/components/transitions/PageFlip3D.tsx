"use client";

import React from "react";
import { motion } from "framer-motion";
import { usePageFlip } from "@/context/PageFlipContext";
import { cn } from "@/lib/utils";

interface PageFlip3DProps {
  front: React.ReactNode;
  back: React.ReactNode;
  className?: string;
}

export function PageFlip3D({ front, back, className }: PageFlip3DProps) {
  const { isFlipped, isAnimating } = usePageFlip();

  return (
    <div
      className={cn(
        "relative w-full min-h-screen",
        isAnimating && "h-screen overflow-hidden",
        className
      )}
      style={{
        perspective: "1200px",
      }}
    >
      <motion.div
        className="w-full min-h-screen relative"
        style={{
          transformStyle: "preserve-3d",
        }}
        initial={false}
        animate={{
          rotateY: isFlipped ? 180 : 0,
        }}
        transition={{
          duration: 0.7,
          ease: [0.645, 0.045, 0.355, 1], // Smooth book page-turn easing
        }}
      >
        {/* ─── FRONT FACE (Landing / Marketing Page) ─── */}
        <div
          className={cn(
            "w-full",
            isFlipped
              ? "absolute inset-0 h-screen overflow-hidden pointer-events-none -z-10"
              : "relative min-h-screen pointer-events-auto",
            isAnimating && "h-screen overflow-hidden"
          )}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transformStyle: "preserve-3d",
            transform: "rotateY(0deg)",
          }}
        >
          {front}

          {/* Front dynamic shadow overlay for 3D depth during mid-flip */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-50 bg-gradient-to-r from-black/60 via-black/30 to-transparent"
            initial={false}
            animate={{
              opacity: isAnimating ? [0, 0.45, 0] : 0,
            }}
            transition={{
              duration: 0.7,
              ease: "easeInOut",
            }}
          />
        </div>

        {/* ─── BACK FACE (Login Page) ─── */}
        <div
          className={cn(
            "w-full",
            isFlipped
              ? "relative min-h-screen pointer-events-auto z-10"
              : "absolute inset-0 h-screen overflow-hidden pointer-events-none -z-10",
            isAnimating && "h-screen overflow-hidden"
          )}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transformStyle: "preserve-3d",
            transform: "rotateY(180deg)",
          }}
        >
          {back}

          {/* Back dynamic shadow overlay for 3D depth during mid-flip */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-50 bg-gradient-to-l from-black/60 via-black/30 to-transparent"
            initial={false}
            animate={{
              opacity: isAnimating ? [0, 0.45, 0] : 0,
            }}
            transition={{
              duration: 0.7,
              ease: "easeInOut",
            }}
          />
        </div>
      </motion.div>
    </div>
  );
}
