import type { SVGProps } from "react";

/**
 * Sidebar toggle icons matching the visual design.
 * Features a split panel (sidebar on left) with directional chevrons.
 */
export function SidebarCollapseIcon({
  className = "w-4 h-4",
  ...props
}: SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Outer rounded window/container */}
      <rect width="18" height="18" x="3" y="3" rx="3.5" />
      {/* Vertical sidebar divider */}
      <line x1="9" y1="3" x2="9" y2="21" />
      {/* Left chevron (<) inside the sidebar panel */}
      <path d="m7 9.5-2.5 2.5 2.5 2.5" />
    </svg>
  );
}

export function SidebarExpandIcon({
  className = "w-4 h-4",
  ...props
}: SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Outer rounded window/container */}
      <rect width="18" height="18" x="3" y="3" rx="3.5" />
      {/* Vertical sidebar divider */}
      <line x1="9" y1="3" x2="9" y2="21" />
      {/* Right chevron (>) inside the sidebar panel */}
      <path d="m4.5 9.5 2.5 2.5-2.5 2.5" />
    </svg>
  );
}
