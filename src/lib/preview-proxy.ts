import { AGENT_SCRIPT_TAG } from "@/lib/visual-edit-agent";

/**
 * ═══ THE PREVIEW-PROXY REWRITES (the visual editor) ═══════════════
 *
 * Pure string work, extracted from the route because **a Next.js route file may
 * only export HTTP methods** — exporting a helper from it fails the build with
 * "is not a valid Route export field". Which is a happy accident: here they are
 * unit-testable, and the HTML rewrite is exactly the kind of thing that needs tests.
 */

/**
 * Point root-absolute URLs at the proxy.
 *
 * ⚠️ ATTRIBUTE-SCOPED, NOT A BLIND STRING REPLACE. Rewriting every `"/` in the
 * document would corrupt inline JSON, script bodies and text content. Only
 * `src`/`href`/`action`/`srcset`/`content` values that start with a single `/` are
 * touched — `//cdn.example.com` is protocol-relative and must be left alone.
 *
 * Next.js also embeds `/_next/...` inside its bootstrap JSON payload, so those are
 * rewritten too; that is the one string form specific enough to be safe.
 *
 * ⚠️ THIS IS ONLY HALF THE JOB, AND THAT IS WHY THE PREVIEW USED TO BE BLANK.
 * It can only fix URLs that appear in the HTML. Next.js computes most of its chunk
 * URLs at RUNTIME from a `publicPath` inlined at build time, which no amount of HTML
 * rewriting can reach. The other half is `PREVIEW_RUNTIME_SHIM`, injected by
 * `injectAgent` below — see the long note on it in `visual-edit-agent.ts`.
 */
export function rewriteHtml(html: string, base: string): string {
    const rewritten = html
        // ⚠️ Strip <link rel="preload" as="font"> tags that point at /_next/static/media/
        // fonts — those are baked into the parent app's layout and leak into proxied child
        // workspace HTML. The child never serves those font files so the browser fires a
        // "preloaded but not used" warning for every one of them on every page load.
        .replace(/<link[^>]+rel=["']preload["'][^>]+as=["']font["'][^>]*\/?>/gi, "")
        .replace(/<link[^>]+as=["']font["'][^>]+rel=["']preload["'][^>]*\/?>/gi, "")
        .replace(/(\s(?:src|href|action|poster)\s*=\s*")\/(?!\/)/g, `$1${base}/`)
        .replace(/(\s(?:src|href|action|poster)\s*=\s*')\/(?!\/)/g, `$1${base}/`)
        .replace(/(\ssrcset\s*=\s*")([^"]*)"/g, (_full, prefix: string, value: string) => {
            const next = value
                .split(",")
                .map(part => part.trim().replace(/^\/(?!\/)/, `${base}/`))
                .join(", ");
            return `${prefix}${next}"`;
        })
        .replace(/"\/_next\//g, `"${base}/_next/`);

    // Vite places its React-refresh imports in an inline module script in the
    // HTML document. Rewrite only those script bodies: applying JavaScript
    // patterns to the whole document could alter visible copy or JSON data.
    return rewritten.replace(
        /(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi,
        (full, opening: string, attributes: string, body: string, closing: string) => {
            const isInlineModule =
                !/\bsrc\s*=/i.test(attributes) &&
                /\btype\s*=\s*(["'])module\1/i.test(attributes);
            return isInlineModule
                ? `${opening}${rewriteJavaScript(body, base)}${closing}`
                : full;
        }
    );
}

/**
 * Put the editor bundle (runtime shim + agent) at the very TOP of `<head>`.
 *
 * ⚠️⚠️ THE POSITION IS LOAD-BEARING, NOT TIDINESS. It used to be injected before
 * `</head>`, i.e. AFTER the app's own `<script async>` tags. The runtime shim has to
 * patch `document.createElement` and `fetch` **before any application code runs**, or
 * the first chunk request escapes the proxy and 404s. First in `<head>` is the only
 * position that guarantees that.
 *
 * The fallbacks walk down in order of how much of the document we can see: an opening
 * `<head>`, then `<html>`, then `<body>`, then the front of whatever we were given.
 */
/**
 * Point root-absolute `url(...)` references in a stylesheet at the proxy.
 *
 * ⚠️ CSS IS A THIRD URL SPACE the HTML rewrite and the runtime shim both miss.
 * Next.js emits `url(/_next/static/media/….woff2)` inside its stylesheets; those are
 * resolved by the CSS engine, not by webpack and not by any DOM API we can patch, so
 * they 404ed at the platform root. Fonts failing is only cosmetic — the page falls
 * back — but it is four console errors on every preview and it is two lines to fix.
 *
 * Quoted, single-quoted and bare forms are all handled; `//host` and `data:` are left
 * alone.
 */
export function rewriteCss(css: string, base: string): string {
    return css.replace(
        /url\(\s*(['"]?)\/(?!\/)/g,
        (_full, quote: string) => `url(${quote}${base}/`
    );
}

/**
 * Keep root-absolute ESM dependencies inside the same-origin preview proxy.
 * Vite emits imports such as `/@vite/client` and `/node_modules/.vite/...` in
 * JavaScript responses; HTML and DOM-runtime rewriting cannot see those static
 * module specifiers, so without this pass the browser requests the builder root.
 */
export function rewriteJavaScript(source: string, base: string): string {
    return source
        .replace(
            /(\b(?:from|import)\s*(?:\(\s*)?["'])\/(?!\/)/g,
            `$1${base}/`
        )
        .replace(
            /(\bnew\s+URL\s*\(\s*["'`])\/(?!\/)/g,
            `$1${base}/`
        );
}

/**
 * Error boundary overlay injected into every preview iframe.
 * Catches runtime errors, unhandled promise rejections, and Next.js
 * compilation errors, then replaces the blank white screen with a
 * styled diagnostic card.
 */
const ERROR_BOUNDARY_SCRIPT = `<script data-error-boundary>
(function(){
  var overlay = null;
  var errorQueue = [];
  var MAX_ERRORS = 5;

  function createOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = '__error-boundary-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:20px;overflow:auto;';
    overlay.innerHTML = '<div style="max-width:560px;width:100%;background:#1a1a2e;border:1px solid #e74c3c;border-radius:12px;padding:28px;color:#fff;box-shadow:0 25px 50px rgba(0,0,0,0.5);">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">'
      + '<div style="width:32px;height:32px;border-radius:8px;background:#e74c3c;display:flex;align-items:center;justify-content:center;font-size:18px;">⚠️</div>'
      + '<h2 style="margin:0;font-size:18px;font-weight:600;color:#ff6b6b;">Preview Error</h2>'
      + '</div>'
      + '<div id="__error-list" style="margin-bottom:16px;"></div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button onclick="document.getElementById(\\'__error-boundary-overlay\\').style.display=\\'none\\'" style="flex:1;padding:10px 16px;border-radius:8px;border:1px solid #333;background:#2a2a3e;color:#ccc;cursor:pointer;font-size:13px;">Dismiss</button>'
      + '<button onclick="location.reload()" style="flex:1;padding:10px 16px;border-radius:8px;border:none;background:#e74c3c;color:#fff;cursor:pointer;font-size:13px;font-weight:500;">Reload Preview</button>'
      + '</div>'
      + '<p style="margin:12px 0 0;font-size:11px;color:#666;text-align:center;">💡 Tip: Ask the AI to fix the error shown above</p>'
      + '</div>';
    return overlay;
  }

  function addError(msg, source) {
    if (errorQueue.length >= MAX_ERRORS) return;
    errorQueue.push({ msg: msg, source: source });

    var list = overlay ? document.getElementById('__error-list') : null;
    if (!list) {
      createOverlay();
      if (document.body) document.body.appendChild(overlay);
      else document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(overlay); });
      list = document.getElementById('__error-list');
    }
    if (!list) return;

    var item = document.createElement('div');
    item.style.cssText = 'background:#16213e;border:1px solid #1a1a3e;border-radius:8px;padding:12px;margin-bottom:8px;';
    var srcHtml = source ? '<div style="font-size:11px;color:#888;margin-bottom:4px;">📁 ' + source.replace(/</g,'&lt;') + '</div>' : '';
    item.innerHTML = srcHtml + '<pre style="margin:0;font-size:12px;color:#ff8a80;white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto;">' + String(msg).replace(/</g,'&lt;').substring(0, 500) + '</pre>';
    list.appendChild(item);
  }

  window.addEventListener('error', function(e) {
    var source = e.filename ? e.filename.replace(/.*\\//, '') + ':' + e.lineno : '';
    addError(e.message || 'Unknown error', source);
  });

  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled promise rejection';
    addError(msg, '');
  });

  // Intercept Next.js runtime errors shown as full-page overlays
  var origCE = document.createElement.bind(document);
  document.createElement = function(tag) {
    var el = origCE(tag);
    if (tag === 'nextjs-portal') {
      setTimeout(function() {
        var shadow = el.shadowRoot;
        if (shadow) {
          var text = shadow.textContent || '';
          if (text.length > 20) addError(text.substring(0, 300), 'Next.js Compilation');
        }
      }, 500);
    }
    return el;
  };
})();
</script>`;

export function injectAgent(html: string, base: string): string {
    const tag = ERROR_BOUNDARY_SCRIPT + AGENT_SCRIPT_TAG(base);

    const headOpen = /<head[^>]*>/i.exec(html);
    if (headOpen) {
        const at = headOpen.index + headOpen[0].length;
        return html.slice(0, at) + tag + html.slice(at);
    }

    const htmlOpen = /<html[^>]*>/i.exec(html);
    if (htmlOpen) {
        const at = htmlOpen.index + htmlOpen[0].length;
        return html.slice(0, at) + tag + html.slice(at);
    }

    const bodyOpen = /<body[^>]*>/i.exec(html);
    if (bodyOpen) {
        const at = bodyOpen.index + bodyOpen[0].length;
        return html.slice(0, at) + tag + html.slice(at);
    }

    return `${tag}${html}`;
}
