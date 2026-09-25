export interface PreviewReadiness {
  ok: boolean;
  error?: string;
}

type PreviewFetch = typeof fetch;

function assetReferences(html: string): Array<{ url: string; kind: "script" | "style" }> {
  const references: Array<{ url: string; kind: "script" | "style" }> = [];
  for (const tag of html.match(/<script\b[^>]*>/gi) || []) {
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) references.push({ url: src, kind: "script" });
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const relation = /\srel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const kind = relation === "stylesheet" ? "style" : relation === "modulepreload" ? "script" : null;
    if (!kind) continue;
    const href = /\shref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) references.push({ url: href, kind });
  }
  return references;
}

/** A 200 document is insufficient: Vite can serve HTML while its JS is missing. */
export async function probeBuiltPreview(
  previewUrl: string,
  options: { signal?: AbortSignal; fetcher?: PreviewFetch; timeoutMs?: number } = {}
): Promise<PreviewReadiness> {
  const fetcher = options.fetcher || fetch;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs || 4_000)])
    : AbortSignal.timeout(options.timeoutMs || 4_000);
  try {
    const base = new URL(previewUrl);
    const page = await fetcher(base, { signal, cache: "no-store", redirect: "error" });
    if (!page.ok) return { ok: false, error: `Preview returned HTTP ${page.status}` };
    if (!/text\/html/i.test(page.headers.get("content-type") || "")) {
      return { ok: false, error: "Preview returned a non-HTML document" };
    }
    const html = await page.text();
    // External fonts and analytics are optional to the generated application's
    // startup. Only its own build assets determine whether the preview is ready.
    const assets = assetReferences(html).filter((asset) =>
      new URL(asset.url, base).origin === base.origin
    );
    if (!assets.some((asset) => asset.kind === "script")) {
      return { ok: false, error: "Preview HTML has no JavaScript entrypoint" };
    }
    for (const asset of assets) {
      const assetUrl = new URL(asset.url, base);
      const response = await fetcher(assetUrl, { signal, cache: "no-store", redirect: "error" });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) return { ok: false, error: `Preview ${asset.kind} returned HTTP ${response.status}` };
      if (asset.kind === "script" && !/(?:java|ecma)script/i.test(contentType)) {
        return { ok: false, error: `Preview JavaScript has invalid content type: ${contentType || "missing"}` };
      }
      if (asset.kind === "style" && !/text\/css/i.test(contentType)) {
        return { ok: false, error: `Preview stylesheet has invalid content type: ${contentType || "missing"}` };
      }
      if (asset.kind === "style") {
        const css = await response.text();
        if (!css.trim() || /@tailwind\s+utilities\b/.test(css)) {
          return { ok: false, error: "Preview stylesheet is empty or Tailwind utilities were not compiled" };
        }
      } else {
        void response.body?.cancel().catch(() => undefined);
      }
    }
    return { ok: true };
  } catch (error) {
    options.signal?.throwIfAborted();
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
