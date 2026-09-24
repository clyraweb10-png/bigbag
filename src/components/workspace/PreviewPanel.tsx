"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { Monitor, Loader2, Archive } from "lucide-react";
import { SkeletonAppPreview } from "@/components/primitives";

interface PreviewPanelProps {
  previewUrl: string | null;
  onRefresh: () => void;
  loading?: boolean;
  mobilePreview?: boolean;
  iframePath?: string;
  cached?: boolean;
  /**
   * ═══⭐⭐ THE SANDBOXED PREVIEW, AND WHY IT EXISTS ════════════════════════
   *
   * The injected in-page agent selects elements, reads computed styles and applies
   * live edits. The parent communicates with it through a random postMessage
   * channel and never receives same-origin DOM access.
   *
   * In local-orchestrator mode this is also the stable persistent preview route.
   * Normal and editor documents both remain browser-sandboxed; `editor=1` only
   * selects the owner-gated editor flow.
   */
  proxiedSrc?: string | null;
  /** The editor needs the element to `postMessage` to its injected agent. */
  frameRef?: RefObject<HTMLIFrameElement | null>;
  /** Request the owner-gated visual-editor document while editing. */
  trustedEditor?: boolean;
}

function MobileDeviceShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex flex-col bg-[#0c0d10] border-[3px] border-[#222328] rounded-[46px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.08),inset_0_0_0_1px_rgba(255,255,255,0.06)] px-2.5 pt-2 pb-2.5 shrink-0 transition-all duration-300 mx-auto select-none"
      style={{
        width: "395px",
        maxWidth: "calc(100% - 1.5rem)",
        height: "760px",
        maxHeight: "calc(100% - 1.5rem)",
      }}
    >
      {/* Top phone bezel with speaker slit and front camera */}
      <div className="relative h-8 w-full flex items-center justify-center shrink-0">
        {/* Front camera lens */}
        <div className="absolute left-8 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#16171b] border border-[#26282f] flex items-center justify-center shadow-inner">
          <div className="w-1 h-1 rounded-full bg-[#0a0a0d]" />
        </div>
        {/* Centered earpiece speaker grill */}
        <div className="w-14 h-1 rounded-full bg-[#23252a] border border-white/5 shadow-inner" />
      </div>

      {/* Screen container */}
      <div className="relative flex-1 min-h-0 w-full rounded-[28px] overflow-hidden bg-white dark:bg-zinc-950 shadow-inner border border-black/10">
        {children}
      </div>

      {/* Bottom phone bezel / chin with home indicator */}
      <div className="h-7 w-full flex items-center justify-center shrink-0">
        <div className="w-28 h-1 rounded-full bg-neutral-600/40" />
      </div>
    </div>
  );
}

export function PreviewPanel({ previewUrl, loading, mobilePreview = false, iframePath = "/", cached = false, proxiedSrc, frameRef, trustedEditor = false }: PreviewPanelProps) {
  const [iframeLoading, setIframeLoading] = useState(true);
  const [editorChannel, setEditorChannel] = useState("");
  useEffect(() => setEditorChannel(crypto.randomUUID()), []);
  /** ⚠️ The proxy wins when present — see `proxiedSrc`. */
  const base = (proxiedSrc || previewUrl || "").replace(/\/$/, "");
  const iframeRoute = base ? (iframePath === "/" ? `${base}/` : `${base}${iframePath}`) : null;
  const fullIframeUrl = iframeRoute && trustedEditor
    ? `${iframeRoute}${iframeRoute.includes("?") ? "&" : "?"}editor=1&__ve_channel=${encodeURIComponent(editorChannel)}`
    : iframeRoute;

  const iframeContent = (
    <>
      {iframeLoading && (
        <div className="absolute inset-0 z-10 bg-background transition-opacity duration-300 overflow-hidden">
          <SkeletonAppPreview mobile={mobilePreview} />
        </div>
      )}
      <iframe
        /* ⚠️ REMOUNT WHEN THE ORIGIN CHANGES. Swapping the `src` between the direct
           URL and the proxy without a new element leaves the old document (and its
           injected agent, or lack of one) in place. */
        key={proxiedSrc ? "proxy" : "direct"}
        ref={frameRef}
        name={editorChannel}
        data-editor-channel={editorChannel}
        src={editorChannel ? fullIframeUrl || undefined : undefined}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        title="Preview"
        onLoad={() => setIframeLoading(false)}
      />
    </>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* iframe - no URL bar here, it's in the header now */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative" style={{ background: "#fcfbf8" }}>
        {/* Cached snapshot indicator: shown when the dev server is not active and
            we're displaying the cachedDevelopmentUrl static snapshot */}
        {previewUrl && cached && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-medium px-2.5 py-1 rounded-full shadow-sm">
            <Archive className="w-3 h-3" />
            <span>Cached snapshot · server sleeping</span>
          </div>
        )}
        {previewUrl && loading && !cached && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/95 px-2.5 py-1 text-[11px] font-medium text-blue-800 shadow-sm backdrop-blur">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            <span className="truncate">Updating · current preview remains available</span>
          </div>
        )}
        {!previewUrl ? (
          loading ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-3.5 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span>Building your app · preview will appear when ready</span>
              </div>
              {mobilePreview ? (
                <MobileDeviceShell>
                  <SkeletonAppPreview mobile={true} />
                </MobileDeviceShell>
              ) : (
                <div className="w-full h-full">
                  <SkeletonAppPreview mobile={false} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center px-8">
              <Monitor className="w-10 h-10 text-gray-300 mb-4" />
              <p className="text-sm font-medium text-gray-500 mb-1">No preview yet</p>
              <p className="text-xs text-gray-400">Send a prompt to start building</p>
            </div>
          )
        ) : (
          mobilePreview ? (
            <MobileDeviceShell>
              {iframeContent}
            </MobileDeviceShell>
          ) : (
            <div className="w-full h-full bg-white transition-all duration-300 relative">
              {iframeContent}
            </div>
          )
        )}
      </div>
    </div>
  );
}
