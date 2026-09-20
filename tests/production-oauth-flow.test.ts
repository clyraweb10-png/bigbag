import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  isProtectedPagePath,
  LOCAL_DEV_ORIGIN,
  oauthCallbackUrl,
  OAUTH_CALLBACK_PATH,
  resolveAppOrigin,
  safeAuthReturnPath,
} from "../src/lib/auth-redirect";

const RENDER_PROD_URL = "https://vibecode-spzy.onrender.com";

function setNodeEnv(value: string | undefined) {
  (process.env as Record<string, string | undefined>)["NODE_ENV"] = value;
}

test("1. Canonical origin resolution in production mode", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_APP_URL = "https://vibecode-spzy.onrender.com/";

    // Calling resolveAppOrigin() without args in production
    const origin1 = resolveAppOrigin();
    assert.equal(origin1, RENDER_PROD_URL, "Production origin must match NEXT_PUBLIC_APP_URL exactly without trailing slash");
    assert.ok(!origin1.includes("localhost"), "Production origin must NEVER contain localhost");

    // Calling with request headers that report localhost internally (Docker port 3000 binding)
    const reqWithLocalhost = {
      headers: {
        get: (name: string) => {
          if (name === "host") return "localhost:3000";
          if (name === "x-forwarded-host") return "127.0.0.1:3000";
          if (name === "x-forwarded-proto") return "http";
          return null;
        },
      },
    };
    const origin2 = resolveAppOrigin(reqWithLocalhost);
    assert.equal(origin2, RENDER_PROD_URL, "Docker internal localhost:3000 must NOT leak into production origin");
    assert.ok(!origin2.includes("localhost"), "Must never return localhost in production even if request has localhost headers");

    // Calling with empty request
    const origin3 = resolveAppOrigin({});
    assert.equal(origin3, RENDER_PROD_URL, "Empty request in production must return RENDER_PROD_URL");
  } finally {
    setNodeEnv(originalEnv);
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  }
});

test("2. Canonical origin resolution in local development mode", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    setNodeEnv("development");
    delete process.env.NEXT_PUBLIC_APP_URL;

    // Local dev without request
    const devOrigin = resolveAppOrigin();
    assert.equal(devOrigin, LOCAL_DEV_ORIGIN, "Development origin must default to http://localhost:3000");

    // Local dev with request
    const devReq = {
      headers: {
        get: (name: string) => (name === "host" ? "localhost:3000" : null),
      },
    };
    const devReqOrigin = resolveAppOrigin(devReq);
    assert.equal(devReqOrigin, "http://localhost:3000", "Development request must preserve localhost:3000");
  } finally {
    setNodeEnv(originalEnv);
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  }
});

test("3. Safe return path validation", () => {
  assert.equal(safeAuthReturnPath(null), "/dashboard");
  assert.equal(safeAuthReturnPath(""), "/dashboard");
  assert.equal(safeAuthReturnPath("/dashboard"), "/dashboard");
  assert.equal(safeAuthReturnPath("/project/test-project-123"), "/project/test-project-123");
  assert.equal(safeAuthReturnPath("/generate?prompt=Create%20SaaS"), "/generate?prompt=Create%20SaaS");

  // Prevent open redirect attacks to external hosts or localhost
  assert.equal(safeAuthReturnPath("http://localhost:3000/dashboard"), "/dashboard");
  assert.equal(safeAuthReturnPath("https://evil.com/phishing"), "/dashboard");
  assert.equal(safeAuthReturnPath("//evil.com/phishing"), "/dashboard");
  assert.equal(safeAuthReturnPath("/login"), "/dashboard");
  assert.equal(safeAuthReturnPath("/api/sensitive"), "/dashboard");
});

test("4. Protected page path recognition", () => {
  assert.equal(isProtectedPagePath("/dashboard"), true);
  assert.equal(isProtectedPagePath("/generate"), true);
  assert.equal(isProtectedPagePath("/project/abc"), true);
  assert.equal(isProtectedPagePath("/auth/callback"), false, "/auth/callback must NOT be protected (must allow OAuth exchange)");
  assert.equal(isProtectedPagePath("/login"), false);
});

test("5. Live Supabase Google OAuth endpoint verification", async () => {
  const supabaseUrl = "https://dgtkizrvagvfnbdkdnfs.supabase.co";
  const supabaseAnonKey = "sb_publishable_6rAsAZ251qMCTSBToJH0HA_9CglSc8U";
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const targetRedirectTo = `${RENDER_PROD_URL}${OAUTH_CALLBACK_PATH}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: targetRedirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "select_account",
      },
    },
  });

  assert.equal(error, null, "Supabase signInWithOAuth must not return an error");
  assert.ok(data?.url, "Supabase must return an authorization URL");

  const authUrl = new URL(data.url);
  assert.equal(authUrl.origin, supabaseUrl, "OAuth URL must originate from configured Supabase instance");
  assert.equal(authUrl.pathname, "/auth/v1/authorize");
  assert.equal(authUrl.searchParams.get("provider"), "google");

  const forwardedRedirectTo = authUrl.searchParams.get("redirect_to");
  assert.equal(forwardedRedirectTo, targetRedirectTo, "Supabase redirect_to parameter MUST use the registered production API callback");
  assert.ok(!forwardedRedirectTo.includes("localhost"), "redirect_to MUST NEVER contain localhost:3000");

  // Follow the 302 redirect from Supabase to Google
  const response = await fetch(data.url, { redirect: "manual" });
  assert.equal(response.status, 302, "Supabase authorize endpoint must return 302 redirect to Google");

  const location = response.headers.get("location");
  assert.ok(location, "Redirect response must include Location header");

  const googleUrl = new URL(location);
  assert.equal(googleUrl.hostname, "accounts.google.com", "Location must point to accounts.google.com");
  assert.equal(googleUrl.searchParams.get("redirect_to"), targetRedirectTo, "Google OAuth URL redirect_to MUST retain the registered production API callback");
  assert.ok(!location.includes("localhost:3000"), "Google OAuth Location header MUST NEVER contain localhost:3000");
});

test("6. Full Production OAuth redirect chain simulation", async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_APP_URL = "https://vibecode-spzy.onrender.com/";

    // Step A: User clicks "Sign in with Google" on https://vibecode-spzy.onrender.com/login
    const clientOrigin = resolveAppOrigin();
    assert.equal(clientOrigin, RENDER_PROD_URL);
    const initiatedRedirectTo = oauthCallbackUrl(clientOrigin);
    assert.equal(initiatedRedirectTo, "https://vibecode-spzy.onrender.com/api/auth/callback");

    // Step B: Server-side forwarder route: GET /api/auth/callback?code=mock_oauth_code
    // Import API route handler
    const { GET: apiCallbackHandler } = require("../src/app/api/auth/callback/route") as typeof import("../src/app/api/auth/callback/route");

    // Mock NextRequest for incoming callback with code
    const mockRequestWithCode = {
      url: "http://0.0.0.0:3000/api/auth/callback?code=mock_oauth_code_xyz",
      headers: new Headers({
        host: "localhost:3000",
        "x-forwarded-host": "localhost:3000",
        "x-forwarded-proto": "http",
      }),
    } as any;

    const apiResponse = await apiCallbackHandler(mockRequestWithCode);
    assert.equal(apiResponse.status, 307, "API callback route must return 307 redirect");
    const forwardedLocation = apiResponse.headers.get("location");
    assert.equal(
      forwardedLocation,
      "https://vibecode-spzy.onrender.com/auth/callback?code=mock_oauth_code_xyz",
      "API callback redirect must point to https://vibecode-spzy.onrender.com/auth/callback, NOT localhost"
    );
    assert.ok(!forwardedLocation?.includes("localhost"), "API callback redirect must NOT contain localhost");

    // Step C: Server-side forwarder route without code (implicit hash fragment)
    const mockRequestNoCode = {
      url: "http://0.0.0.0:3000/api/auth/callback",
      headers: new Headers({
        host: "localhost:3000",
      }),
    } as any;

    const htmlResponse = await apiCallbackHandler(mockRequestNoCode);
    assert.equal(htmlResponse.status, 200);
    const htmlBody = await htmlResponse.text();
    assert.ok(
      htmlBody.includes("https://vibecode-spzy.onrender.com/auth/callback"),
      "HTML forwarder script must target https://vibecode-spzy.onrender.com/auth/callback"
    );
    assert.ok(!htmlBody.includes("localhost:3000"), "HTML forwarder script must NOT contain localhost:3000");

    // Step D: Client-side /auth/callback destination computation
    const searchParamsWithNoNext = new URLSearchParams("code=mock_oauth_code_xyz");
    const dest1 = safeAuthReturnPath(searchParamsWithNoNext.get("next"), "/dashboard");
    const finalNavUrl1 = `${resolveAppOrigin()}${dest1}`;
    assert.equal(finalNavUrl1, "https://vibecode-spzy.onrender.com/dashboard", "Successful production Google login ends at /dashboard on https://vibecode-spzy.onrender.com");
    assert.ok(!finalNavUrl1.includes("localhost"), "Final navigation URL must never be localhost");

    // Step E: Client-side with return path e.g. /project/my-app
    const searchParamsWithNext = new URLSearchParams("code=mock_oauth_code_xyz&next=%2Fproject%2Fmy-app");
    const dest2 = safeAuthReturnPath(searchParamsWithNext.get("next"), "/dashboard");
    const finalNavUrl2 = `${resolveAppOrigin()}${dest2}`;
    assert.equal(finalNavUrl2, "https://vibecode-spzy.onrender.com/project/my-app");
    assert.ok(!finalNavUrl2.includes("localhost"));
  } finally {
    setNodeEnv(originalEnv);
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  }
});

test("7. Next.js proxy middleware unauthenticated redirect respects environment", async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    // 7A: Production
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_APP_URL = "https://vibecode-spzy.onrender.com/";

    const { proxy } = require("../src/proxy") as typeof import("../src/proxy");

    const prodDashboardReq = {
      method: "GET",
      nextUrl: {
        pathname: "/dashboard",
        search: "",
      },
      headers: new Headers({
        host: "localhost:3000",
      }),
      cookies: {
        get: () => undefined,
      },
    } as any;

    const prodRedirect = await proxy(prodDashboardReq);
    assert.equal(prodRedirect.status, 307);
    const prodLocation = prodRedirect.headers.get("location");
    assert.equal(
      prodLocation,
      "https://vibecode-spzy.onrender.com/login?next=%2Fdashboard",
      "Production unauthenticated /dashboard access must redirect to https://vibecode-spzy.onrender.com/login"
    );
    assert.ok(!prodLocation?.includes("localhost:3000"), "Production login redirect must NOT contain localhost:3000");

    // 7B: Development
    setNodeEnv("development");
    delete process.env.NEXT_PUBLIC_APP_URL;

    const devDashboardReq = {
      method: "GET",
      nextUrl: {
        pathname: "/dashboard",
        search: "",
      },
      headers: new Headers({
        host: "localhost:3000",
      }),
      cookies: {
        get: () => undefined,
      },
    } as any;

    const devRedirect = await proxy(devDashboardReq);
    assert.equal(devRedirect.status, 307);
    const devLocation = devRedirect.headers.get("location");
    assert.equal(
      devLocation,
      "http://localhost:3000/login?next=%2Fdashboard",
      "Development unauthenticated /dashboard access must redirect to http://localhost:3000/login"
    );
  } finally {
    setNodeEnv(originalEnv);
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  }
});

test("8. Session route GET provides runtime Supabase configuration without secrets", async () => {
  const { GET: sessionGetHandler } = require("../src/app/api/auth/session/route") as typeof import("../src/app/api/auth/session/route");

  const mockReq = {
    cookies: {
      get: () => undefined,
    },
  } as any;

  const res = await sessionGetHandler(mockReq);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.data.authenticated, false);
  assert.equal(json.data.configured, true);
  assert.equal(json.data.supabase.url, "https://dgtkizrvagvfnbdkdnfs.supabase.co");
  assert.equal(json.data.supabase.anonKey, "sb_publishable_6rAsAZ251qMCTSBToJH0HA_9CglSc8U");
});
