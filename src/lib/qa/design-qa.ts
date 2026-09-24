/**
 * BigBag Design QA — Part 5 Capstone
 *
 * Static checklist that the generator uses to self-assess generated app
 * quality before declaring generation complete. These checks extend the
 * existing AST-based generation-validator.ts with design-system-specific,
 * responsive, accessibility, interaction, and data/state checks.
 *
 * IMPORTANT: This module provides:
 *   1. Static regex/string checks run against generated source text
 *      (integrated into the generation-validator pipeline)
 *   2. Structured checklist constants that the LLM system prompt references
 *
 * It does NOT replace generation-validator.ts — it extends it.
 * Runtime browser checks (real interaction testing, computed contrast)
 * are handled by runtime-validator.ts and the e2b sandbox build step.
 */

import type { FailureCategory, IssueReport, Severity } from "../qa/failures";
import { randomUUID } from "node:crypto";

// ── Banned placeholder patterns (extends containsGenerationPlaceholder) ───────

/** Raw strings that must never appear in a finished generated app */
export const BANNED_PLACEHOLDER_STRINGS: readonly string[] = [
  "lorem ipsum",
  "Lorem ipsum",
  "John Doe",
  "Jane Smith",
  "Acme Corp",
  "Test Company",
  "test@test.com",
  "foo@bar.com",
  "example@example.com",
  "Product 1",
  "Product 2",
  "Item 1",
  "Item 2",
  "Task 1",
  "Task 2",
  "User 1",
  "User 2",
  "$0.00",
  "0 users",
  "0%",
  ">N/A<",
  '"N/A"',
  // Raw hex colors that bypass design tokens (common copy-paste mistakes)
  // Only flag obvious ones — full hex detection is too noisy
];

/** Raw hex color patterns that should use CSS variables instead */
export const RAW_HEX_IN_CLASSNAME_PATTERN =
  /className\s*=\s*[`"'][^`"']*(?:text|bg|border)-\[#[0-9a-fA-F]{3,6}\][^`"']*[`"']/g;

/** Inline style with hardcoded color (not a CSS variable) */
export const HARDCODED_COLOR_IN_STYLE =
  /style\s*=\s*\{[^}]*(?:color|background|backgroundColor)\s*:\s*["']#[0-9a-fA-F]{3,6}["'][^}]*\}/g;

/** Forbidden heavy charting libraries */
export const BANNED_CHART_IMPORTS = /from\s+['"](?:recharts|chart\.js|d3|victory|nivo|apexcharts|highcharts)['"]/g;

/** Missing alt attribute on img tags */
export const IMG_WITHOUT_ALT = /<img(?![^>]*\balt\s*=)[^>]*>/gi;

/** Raw <img> without onError (resilient image handling) */
export const IMG_WITHOUT_ONERROR = /<img(?![^>]*\bonError\b)[^>]*(src\s*=)[^>]*>/gi;

/** Decorative infinite animation that disregards prefers-reduced-motion */
export const INFINITE_ANIMATION_IN_CLASSNAME = /animate-(?:spin|bounce|ping|pulse)[^\s"'`}]*/g;

// ── Static source checks ──────────────────────────────────────────────────────

function makeIssue(
  severity: Severity,
  category: FailureCategory,
  location: string,
  description: string,
  recommendedFix: string
): IssueReport {
  return {
    id: randomUUID(),
    severity,
    category,
    location,
    description,
    recommendedFix,
    verificationStatus: "open-non-blocking",
  };
}

/**
 * Run static design-system QA checks against a single generated source file.
 * Returns structured IssueReports that the generation loop can classify and act on.
 */
export function designQAIssues(filePath: string, content: string): IssueReport[] {
  if (!/\.[cm]?[jt]sx?$/.test(filePath)) return [];

  const issues: IssueReport[] = [];

  // ── A1: Content Realism — Placeholder Detection ──────────────────────────
  for (const banned of BANNED_PLACEHOLDER_STRINGS) {
    if (content.includes(banned)) {
      issues.push(makeIssue(
        "BLOCKER",
        "DATA_STATE_ERROR",
        filePath,
        `Contains banned placeholder string: "${banned}"`,
        "Replace with authentic synthetic domain-appropriate content per Part 4 rules."
      ));
    }
  }

  // ── A2: Design Token Compliance — No Raw Hex in class names ──────────────
  const hexClassMatches = [...content.matchAll(RAW_HEX_IN_CLASSNAME_PATTERN)];
  if (hexClassMatches.length > 0) {
    issues.push(makeIssue(
      "MEDIUM",
      "DESIGN_SYSTEM_ERROR",
      filePath,
      `Uses raw hex color(s) in Tailwind class names instead of semantic tokens: ${hexClassMatches.slice(0, 3).map(m => m[0].substring(0, 60)).join(", ")}`,
      "Replace with CSS variable references: bg-[var(--primary)], text-[var(--foreground)], etc."
    ));
  }

  // ── A3: Banned chart library imports ─────────────────────────────────────
  const bannedCharts = [...content.matchAll(BANNED_CHART_IMPORTS)];
  if (bannedCharts.length > 0) {
    issues.push(makeIssue(
      "HIGH",
      "COMPONENT_USAGE_ERROR",
      filePath,
      `Imports a banned charting library: ${bannedCharts.map(m => m[0]).join(", ")}`,
      "Use Sparkline, SimpleBarChart, ChartContainer, or DistributionBar from @/components/ui/."
    ));
  }

  // ── A4: Missing img alt attribute ─────────────────────────────────────────
  const missingAlt = [...content.matchAll(IMG_WITHOUT_ALT)];
  if (missingAlt.length > 0) {
    issues.push(makeIssue(
      "HIGH",
      "ACCESSIBILITY_ERROR",
      filePath,
      `${missingAlt.length} <img> element(s) missing alt attribute`,
      "Add alt=\"\" for decorative images or a meaningful alt description for informative images."
    ));
  }

  // ── A5: Raw <img> without onError resilience ──────────────────────────────
  const rawImgCount = (content.match(/<img\b/gi) || []).length;
  const imageFrameCount = (content.match(/ImageFrame/g) || []).length;
  if (rawImgCount > 0 && imageFrameCount === 0) {
    issues.push(makeIssue(
      "MEDIUM",
      "MEDIA_ERROR",
      filePath,
      `Uses raw <img> tags without ImageFrame or onError fallback (${rawImgCount} instance(s))`,
      "Replace with <ImageFrame> from @/components/ui/image-frame for automatic fallback handling."
    ));
  }

  // ── A6: Detect excessive card nesting (card-soup anti-pattern) ────────────
  const cardCount = (content.match(/\bCard\b/g) || []).length;
  if (cardCount > 20) {
    issues.push(makeIssue(
      "MEDIUM",
      "DESIGN_SYSTEM_ERROR",
      filePath,
      `Potential card-soup: ${cardCount} Card component references in a single file`,
      "Mix layout patterns. Combine cards with tables, lists, hero sections, or feature grids."
    ));
  }

  // ── A7: Infinite animation classes ───────────────────────────────────────
  const infiniteAnims = [...content.matchAll(INFINITE_ANIMATION_IN_CLASSNAME)];
  if (infiniteAnims.length > 2) {
    issues.push(makeIssue(
      "LOW",
      "DESIGN_SYSTEM_ERROR",
      filePath,
      `Multiple infinite animation classes (${infiniteAnims.length}) may violate prefers-reduced-motion`,
      "Limit decorative animations. Prefer animate-fade-up with stagger-N for content reveals."
    ));
  }

  // ── A8: Hardcoded color in inline styles ──────────────────────────────────
  const hardcodedColors = [...content.matchAll(HARDCODED_COLOR_IN_STYLE)];
  if (hardcodedColors.length > 0) {
    issues.push(makeIssue(
      "MEDIUM",
      "DESIGN_SYSTEM_ERROR",
      filePath,
      `${hardcodedColors.length} inline style(s) with hardcoded color values`,
      "Use CSS variables: style={{ color: 'var(--foreground)' }} or Tailwind token classes."
    ));
  }

  return issues;
}

// ── QA Checklists (referenced by SYSTEM_PROMPT) ───────────────────────────────

/**
 * Part A — Design QA checklist.
 * These questions are used in the generator self-check prompt.
 */
export const DESIGN_QA_CHECKLIST = [
  // Typography
  "A1. Typography hierarchy: headings (text-3xl/2xl/xl font-bold) → body (text-sm/base) → caption (text-xs text-muted-foreground) are used consistently.",
  "A2. No arbitrary font sizes outside the Tailwind scale.",
  // Spacing
  "A3. Spacing uses Tailwind scale values (p-4, gap-6, space-y-4). No arbitrary px values on padding/margin.",
  // Tokens
  "A4. No raw hex colors in class names or inline styles. All colors use var(--token) or Tailwind token classes.",
  "A5. Border color is always border-[var(--border)] or border-border. No single-component custom border colors.",
  "A6. Border radius matches the token scale (rounded-md, rounded-lg, rounded-xl, rounded-full). No arbitrary values.",
  "A7. Shadow tier matches the elevation: flat surfaces no shadow, cards shadow-card, popovers shadow-float.",
  // Icons
  "A8. All icons are from lucide-react. No emoji, SVG blobs, or ASCII icons in the UI.",
  "A9. Icon sizes: 16px (h-4 w-4), 20px (h-5 w-5), 24px (h-6 w-6). Not mixing arbitrary sizes.",
  // Components
  "A10. No raw <button>, <input>, <select>, <textarea>, <dialog> when a Part 2 primitive exists in @/components/ui/.",
  "A11. No duplicated near-identical components — reuse the seeded primitives.",
  "A12. One clear primary action (Button variant='default') per view. Secondary actions use outline/ghost.",
  // Layout
  "A13. Layout uses one of the 5 Part 3 shells from @/components/layout/. No custom nav/sidebar built from scratch.",
  "A14. No orphaned full-width sections with no content, no dead zones, no unbalanced whitespace.",
  // Polish anti-patterns
  "A15. No card-soup: entire screen is NOT filled with identical bordered cards. At least 2 layout patterns per page.",
  "A16. No badge/pill overuse: each badge conveys a distinct semantic status (success/warning/destructive/secondary).",
  "A17. No decorative multi-color gradients on dashboards, cards, or tables.",
  "A18. No excessive or distracting animations. Motion serves hierarchy and feedback only.",
] as const;

/**
 * Part B — Responsive QA checklist.
 */
export const RESPONSIVE_QA_CHECKLIST = [
  "B1. No horizontal overflow at 375px, 768px, or 1280px viewport widths.",
  "B2. No clipped or truncated text content at any breakpoint.",
  "B3. Grids collapse correctly: grid-cols-1 sm:grid-cols-2 lg:grid-cols-3/4.",
  "B4. Mobile nav: sidebar hidden on mobile, Sheet drawer trigger present on mobile.",
  "B5. No sidebar overlap or stuck-off-canvas state.",
  "B6. Headings scale down: text-4xl or larger on desktop should be text-2xl or smaller on mobile.",
  "B7. Tables have a defined mobile strategy (overflow-x-auto scroll OR card-transform).",
  "B8. Dialogs and Sheets are usable on mobile (not off-screen, not with trapped scroll).",
  "B9. All nav links and buttons have min-h-[44px] touch targets.",
  "B10. All images have aspect-ratio constraints to prevent layout shift.",
] as const;

/**
 * Part C — Accessibility QA checklist.
 */
export const ACCESSIBILITY_QA_CHECKLIST = [
  "C1. Real semantic HTML: <button>, <a href>, <nav>, <main>, <header>, <form>, <table> used correctly.",
  "C2. All interactive elements are keyboard-reachable with logical tab order.",
  "C3. Focus rings visible on all focusable elements (Part 1 focus-visible:ring-2 ring-[var(--ring)]).",
  "C4. ARIA used only where native semantics are insufficient. No redundant aria-label on <button> with text content.",
  "C5. Dialog/Sheet: focus trapped, Escape closes, aria-modal present.",
  "C6. All form inputs have associated <label> or aria-labelledby.",
  "C7. Form errors shown with FormMessage and associated to the input via aria.",
  "C8. Adequate color contrast (WCAG AA: 4.5:1 for normal text, 3:1 for large text and UI components).",
  "C9. <button> for actions, <a> for navigation. No div-as-button without role='button' + keyboard handler.",
  "C10. Informative images have meaningful alt text. Decorative images have alt=''.",
  "C11. prefers-reduced-motion: all Part 4 CSS animations disabled via the media query in globals.css.",
  "C12. Loading, empty, error states are announced to screen readers (role='status' or live regions where needed).",
] as const;

/**
 * Part D — Interaction QA checklist.
 */
export const INTERACTION_QA_CHECKLIST = [
  "D1. All navigation links resolve (no # placeholder href on any active nav item).",
  "D2. All primary CTA buttons perform their stated action (no empty onClick handlers).",
  "D3. Dropdowns, Dialogs, Sheets open and close correctly.",
  "D4. Tabs switch content panels.",
  "D5. Forms: submit handler present, inline validation shown, success/error feedback rendered.",
  "D6. Search input filters visible results.",
  "D7. Filter controls update the displayed list.",
  "D8. Sort controls reorder the displayed list.",
  "D9. Pagination navigates between pages and updates displayed items.",
  "D10. Cart: add-to-cart updates cart count, remove updates totals, cart drawer shows real items.",
  "D11. Toggle controls change state and propagate the effect.",
  "D12. Mobile hamburger/sheet nav opens and closes.",
  "D13. Loading skeleton shown during any simulated async operation.",
  "D14. EmptyState shown when a list has no items.",
  "D15. Error state shown on simulated fetch/mutation failure.",
  "D16. Success confirmation shown after a completed action.",
] as const;

/**
 * Part E — Data & State QA checklist.
 */
export const DATA_STATE_QA_CHECKLIST = [
  "E1. Seed data is realistic and synthetic. No fixed real companies, no lorem ipsum.",
  "E2. Metrics and KPIs are computed from the seed records — not hardcoded constants.",
  "E3. Filters update results. The filtered list reflects the filter state.",
  "E4. Totals recalculate after mutations (cart changes, record additions/deletions).",
  "E5. EmptyState appears when all items are removed or filtered out.",
  "E6. Loading state appears before data is 'fetched' (even if data is local).",
  "E7. No '$0', '0 users', '0%', 'Product 1', 'Item 2', 'Lorem ipsum', 'John Doe', 'Acme Corp' as content.",
  "E8. No impossible dates (future dates on past events, nonsensical sequences).",
  "E9. No contradictory UI states (filter showing 'all' while displaying filtered subset).",
  "E10. No inconsistent statuses (Delivered order with no shipping record, negative quantities).",
] as const;

/**
 * Part K — Production Readiness gate.
 * Every check must pass before preview is declared successful.
 */
export const PRODUCTION_READINESS_CHECKLIST = [
  "K1. Build passes (exit 0).",
  "K2. TypeScript typecheck passes (exit 0).",
  "K3. No blocking runtime errors (runtime-validator.ts clean).",
  "K4. Primary navigation works.",
  "K5. Primary CTA works.",
  "K6. Primary form works.",
  "K7. No obvious mobile layout failure.",
  "K8. No obvious accessibility blocker.",
  "K9. No broken images without fallbacks.",
  "K10. No placeholder content (BANNED_PLACEHOLDER_STRINGS clean).",
  "K11. No empty/meaningless metric strips (unless intentional empty state was requested).",
  "K12. No major console errors (RUNTIME_ERROR category clean).",
] as const;

// ── Self-correction loop constants ─────────────────────────────────────────────

/** Maximum QA self-correction attempts per detected issue before surfacing to user */
export const MAX_QA_FIX_ATTEMPTS = 3;

/** Severity levels that must be resolved before production readiness is declared */
export const BLOCKING_SEVERITIES: readonly string[] = ["BLOCKER"];
