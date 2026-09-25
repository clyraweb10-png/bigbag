import * as React from "react";

export function AiSparklesIcon({ className = "w-3.5 h-3.5", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3c0 4.5-3.5 8-8 8 4.5 0 8 3.5 8 8 0-4.5 3.5-8 8-8-4.5 0-8-3.5-8-8z" />
      <path d="M19 3v4M21 5h-4" />
      <circle cx="5" cy="19" r="1.5" fill="currentColor" />
    </svg>
  );
}
