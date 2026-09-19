import * as React from "react";

/**
 * Chain link attachment icon matching the requested design (media_1789844203793.png).
 */
export function AttachChainIcon({ className = "w-4 h-4", ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <g transform="rotate(-45 12 12)">
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-2" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </g>
    </svg>
  );
}

export const AttachPaperclipIcon = AttachChainIcon;

/**
 * Official multicolor Figma logo matching Image 2.
 */
export function FigmaColorLogo({ className = "w-4 h-4", ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 38 57"
      fill="none"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="#1ABCFE" />
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" fill="#0ACF83" />
      <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" fill="#FF7262" />
      <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" fill="#F24E1E" />
      <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" fill="#A259FF" />
    </svg>
  );
}
