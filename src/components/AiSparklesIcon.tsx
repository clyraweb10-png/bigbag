import * as React from "react";

/**
 * AI chat-bubble with sparkle icon.
 * Uses `currentColor` so it automatically adapts to dark / light mode
 * and inherits the button's text colour.
 */
export function AiSparklesIcon({
  className = "w-3.5 h-3.5",
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      strokeWidth="28"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Chat-bubble outline */}
      <path d="M68.5 40C39.6 40 16 63.6 16 92.5v303C16 424.4 39.6 448 68.5 448l47.1-.5 29.7 47.3c5.5 8.8 15.3 14.2 25.9 14.2s20.4-5.4 25.9-14.2L226.8 448H443.5c28.9 0 52.5-23.6 52.5-52.5v-303C496 63.6 472.4 40 443.5 40H68.5z" />

      {/* Two dots inside the bubble */}
      <circle cx="155" cy="252" r="26" fill="currentColor" stroke="none" />
      <circle cx="255" cy="252" r="26" fill="currentColor" stroke="none" />

      {/* 4-point sparkle star in the top-right corner */}
      <path
        d="M388 50
           C388 78 366 100 338 100
           C366 100 388 122 388 150
           C388 122 410 100 438 100
           C410 100 388 78 388 50Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
