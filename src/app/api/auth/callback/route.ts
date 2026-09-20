import { NextRequest, NextResponse } from "next/server";
import { resolveAppOrigin } from "@/lib/auth-redirect";

export async function GET(request: NextRequest) {
  const origin = resolveAppOrigin(request);
  const requestUrl = new URL(request.url);

  // If no code/token is present (e.g. implicit flow with URL hash),
  // return an HTML forwarder that can read and forward the hash fragment.
  if (!requestUrl.searchParams.has("code") && !requestUrl.searchParams.has("error")) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecting…</title>
  <script>
    var target = '/auth/callback' + window.location.search + window.location.hash;
    window.location.replace(target);
  </script>
</head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1d1d1c;color:#fff;">
  <p>Connecting securely…</p>
</body>
</html>`;
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Always forward to the client-side /auth/callback page.
  //
  // WHY: Supabase uses PKCE (Proof Key for Code Exchange). The code_verifier
  // is stored in the browser's localStorage. If we attempt exchangeCodeForSession
  // here on the server, Supabase will invalidate the code even though the exchange
  // fails (no verifier). The client-side page then cannot exchange the same code.
  //
  // The client page (/auth/callback/page.tsx) handles:
  //   - exchangeCodeForSession with the localStorage verifier
  //   - POSTing the access_token to /api/auth/session to set the HttpOnly cookie
  //   - Redirecting to /dashboard
  //
  // resolveAppOrigin(request) ensures the redirect points to the public domain
  // (https://vibecode-spzy.onrender.com) even when Docker reports localhost internally.
  return NextResponse.redirect(
    new URL("/auth/callback" + requestUrl.search, origin),
    307
  );
}
