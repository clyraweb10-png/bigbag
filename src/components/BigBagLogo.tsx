"use client";

import Link from "next/link";

interface BigBagLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  href?: string | null;
  hideText?: boolean;
}

export function BigBagLogo({
  className = "",
  size = "md",
  href = "/",
  hideText = false,
}: BigBagLogoProps) {
  const iconSizeClasses = {
    sm: "w-6 h-6 text-xs",
    md: "w-7 h-7 text-xs",
    lg: "w-9 h-9 text-sm",
  }[size];

  const textSizeClasses = {
    sm: "text-sm",
    md: "text-base font-semibold",
    lg: "text-xl font-bold",
  }[size];

  const svgSize = {
    sm: 14,
    md: 16,
    lg: 20,
  }[size];

  const content = (
    <div className={`inline-flex items-center gap-2 select-none group ${className}`}>
      {/* Code Badge: </> */}
      <div
        className={`relative ${iconSizeClasses} rounded-lg flex items-center justify-center font-mono font-bold transition-all duration-300 shadow-xs border border-zinc-300 dark:border-white/20 bg-zinc-100 dark:bg-white/10 text-black dark:text-white group-hover:scale-105 group-hover:border-black/40 dark:group-hover:border-white/40 group-hover:shadow-sm`}
        style={{
          boxShadow: "0 0 12px -3px rgba(0, 0, 0, 0.08)",
        }}
      >
        <svg
          width={svgSize}
          height={svgSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-300 group-hover:scale-110"
        >
          {/* < */}
          <polyline points="7 8 3 12 7 16" />
          {/* / */}
          <line x1="14" y1="4" x2="10" y2="20" strokeWidth="2.2" />
          {/* > */}
          <polyline points="17 8 21 12 17 16" />
        </svg>
      </div>

      {/* Brand text */}
      {!hideText && (
        <div className="flex items-center tracking-tight">
          <span className={`font-bold text-black dark:text-white transition-colors ${textSizeClasses}`}>
            big
          </span>
          <span className={`font-bold text-black dark:text-white transition-colors ${textSizeClasses}`}>
            bag
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-black dark:bg-white ml-0.5 animate-pulse" />
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
        {content}
      </Link>
    );
  }

  return content;
}
