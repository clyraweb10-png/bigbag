import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { NextRequest } from "next/server";
import { establishServerSession } from "../src/lib/auth-server-session";

test("browser authentication requires a successful server session response", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = (async () => Response.json({ ok: true })) as typeof fetch;
    await establishServerSession("synthetic-access-token");

    global.fetch = (async () => Response.json({ ok: false, error: "Token rejected" }, { status: 401 })) as typeof fetch;
    await assert.rejects(establishServerSession("synthetic-access-token"), /Token rejected/);

    global.fetch = (async () => Response.json({ ok: false })) as typeof fetch;
    await assert.rejects(establishServerSession("synthetic-access-token"), /could not be verified/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("server verifies Google tokens with the public Supabase key even when an admin key is configured", async () => {
  const seenKeys: string[] = [];
  const server = createServer((request, response) => {
    seenKeys.push(String(request.headers.apikey || ""));
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization === "Bearer valid-test-token") {
      response.end(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", email: "test@example.invalid" }));
    } else {
      response.statusCode = 401;
      response.end(JSON.stringify({ message: "Invalid JWT" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const oldEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    admin: process.env.SUPABASE_SERVICE_ROLE_KEY,
    secret: process.env.TENANT_COOKIE_SECRET,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-public-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-wrong-admin-key";
  process.env.TENANT_COOKIE_SECRET = "synthetic-session-signing-secret";
  try {
    const { POST } = require("../src/app/api/auth/session/route") as typeof import("../src/app/api/auth/session/route");
    const valid = await POST(new NextRequest("http://localhost:3000/api/auth/session", {
      method: "POST", body: JSON.stringify({ accessToken: "valid-test-token" }),
    }));
    assert.equal(valid.status, 200);
    assert.match(valid.headers.get("set-cookie") || "", /bigbag_auth=/);

    const invalid = await POST(new NextRequest("http://localhost:3000/api/auth/session", {
      method: "POST", body: JSON.stringify({ accessToken: "invalid-test-token" }),
    }));
    assert.equal(invalid.status, 401);
    assert.deepEqual(seenKeys, ["synthetic-public-key", "synthetic-public-key"]);
  } finally {
    for (const [name, value] of [
      ["NEXT_PUBLIC_SUPABASE_URL", oldEnv.url],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", oldEnv.anon],
      ["SUPABASE_SERVICE_ROLE_KEY", oldEnv.admin],
      ["TENANT_COOKIE_SECRET", oldEnv.secret],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
