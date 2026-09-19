"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { Monitor, Loader2, Archive } from "lucide-react";

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
        {!previewUrl ? (
          <div className="flex flex-col items-center justify-center text-center px-8">
            {loading ? (
              <>
                <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
                <p className="text-sm font-medium text-gray-500 mb-1">Building your app...</p>
                <p className="text-xs text-gray-400">Preview will appear when ready</p>
              </>
            ) : (
              <>
                <Monitor className="w-10 h-10 text-gray-300 mb-4" />
                <p className="text-sm font-medium text-gray-500 mb-1">No preview yet</p>
                <p className="text-xs text-gray-400">Send a prompt to start building</p>
              </>
            )}
          </div>
        ) : (
          <div className={`bg-white transition-all duration-300 relative ${
            mobilePreview ? "w-[375px] h-[667px] rounded-[2rem] border-[8px] border-gray-800 overflow-hidden shadow-2xl" : "w-full h-full"
          }`}>
            {iframeLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
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
          </div>
        )}
      </div>
    </div>
  );
}
