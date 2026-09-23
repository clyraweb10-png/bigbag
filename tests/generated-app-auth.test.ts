import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const { GET, POST, PATCH, DELETE } = require("../src/app/api/preview/[projectId]/[[...path]]/route") as typeof import("../src/app/api/preview/[projectId]/[[...path]]/route");
const { durablePersistenceConfigured, durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const { localProjectStore } = require("../src/lib/local-orchestrator/project-store") as typeof import("../src/lib/local-orchestrator/project-store");
const { createPreviewGuestCapability, sealPreviewAuthStorage } = require("../src/lib/local-orchestrator/tenant-context") as typeof import("../src/lib/local-orchestrator/tenant-context");

type RouteContext = { params: Promise<{ projectId: string; path?: string[] }> };

function request(
  url: string,
  method = "GET",
  accessToken?: string,
  data?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(data ? { "content-type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: data ? JSON.stringify({ data }) : undefined,
  });
}

async function payload(response: Response): Promise<{ ok: boolean; data?: any; error?: string }> {
  return await response.json() as { ok: boolean; data?: any; error?: string };
}

const credentialedAuthConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() &&
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() &&
  durablePersistenceConfigured()
);

test("generated app auth enforces real sessions, ownership, CRUD, and refresh persistence", {
  skip: credentialedAuthConfigured ? false : "Credentialed Supabase configuration is unavailable",
}, async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();

  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const clients = [0, 1].map(() => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }));
  const suffix = randomUUID();
  const emails = [0, 1].map((index) => `bigbag-qualification-${index}-${suffix}@invalid.test`);
  const passwords = [0, 1].map(() => `Q!${randomUUID()}a9`);
  const userIds: string[] = [];
  const projectId = `auth-qualification-${suffix}`;
  const tenantId = randomUUID();
  const routeContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "data", "tasks"] }) };
  const collectionUrl = `https://builder.example.test/api/preview/${projectId}/__bigbag/data/tasks`;

  localProjectStore.create({ projectId, tenantId, description: "Generated auth qualification" });
  localProjectStore.update(projectId, { requiresEndUserAuth: true });
  await localProjectStore.flush(projectId);

  try {
    for (let index = 0; index < clients.length; index += 1) {
      const createdUser = await admin.auth.admin.createUser({
        email: emails[index],
        password: passwords[index],
        email_confirm: true,
      });
      assert.ifError(createdUser.error);
      assert.ok(createdUser.data.user?.id, "Supabase Admin did not create a qualification user");
      userIds.push(createdUser.data.user.id);
    }

    const configResponse = await GET(
      request(`https://builder.example.test/api/preview/${projectId}/__bigbag/auth/config`),
      { params: Promise.resolve({ projectId, path: ["__bigbag", "auth", "config"] }) }
    );
    const config = await payload(configResponse);
    assert.equal(configResponse.status, 200);
    assert.equal(config.data?.url, url);
    assert.equal(config.data?.anonKey, anonKey);
    assert.equal(JSON.stringify(config).includes(serviceRole), false, "Auth config exposed the service role key");

    const sessions = [];
    for (let index = 0; index < clients.length; index += 1) {
      const signIn = await clients[index].auth.signInWithPassword({ email: emails[index], password: passwords[index] });
      assert.ifError(signIn.error);
      assert.ok(signIn.data.session?.access_token, "Supabase login did not return a session");
      sessions.push(signIn.data.session.access_token);
    }

    const unauthenticated = await POST(request(collectionUrl, "POST", undefined, { title: "Denied" }), routeContext);
    assert.equal(unauthenticated.status, 401);
    const guestOnly = await POST(request(
      collectionUrl,
      "POST",
      undefined,
      { title: "Still denied" },
      { "x-bigbag-guest": createPreviewGuestCapability(projectId, randomUUID()) }
    ), routeContext);
    assert.equal(guestOnly.status, 401, "A guest capability bypassed required end-user authentication");

    const createResponse = await POST(request(collectionUrl, "POST", sessions[0], { title: "Persisted task", done: false }), routeContext);
    const created = await payload(createResponse);
    assert.equal(createResponse.status, 201);
    assert.equal(created.data?.title, "Persisted task");
    const recordId = String(created.data?._id || "");
    assert.ok(recordId);

    const userAList = await payload(await GET(request(collectionUrl, "GET", sessions[0]), routeContext));
    const userBList = await payload(await GET(request(collectionUrl, "GET", sessions[1]), routeContext));
    assert.equal(userAList.data?.total, 1);
    assert.equal(userBList.data?.total, 0);

    const itemContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "data", "tasks", recordId] }) };
    const itemUrl = `${collectionUrl}/${recordId}`;
    const crossUserPatch = await PATCH(request(itemUrl, "PATCH", sessions[1], { title: "Stolen" }), itemContext);
    const crossUserDelete = await DELETE(request(itemUrl, "DELETE", sessions[1]), itemContext);
    assert.equal(crossUserPatch.status, 404);
    assert.equal(crossUserDelete.status, 404);

    const updateResponse = await PATCH(request(itemUrl, "PATCH", sessions[0], { done: true }), itemContext);
    assert.equal((await payload(updateResponse)).data?.done, true);

    assert.ifError((await clients[0].auth.signOut()).error);
    const signInAgain = await clients[0].auth.signInWithPassword({ email: emails[0], password: passwords[0] });
    assert.ifError(signInAgain.error);
    const refreshedList = await payload(await GET(request(collectionUrl, "GET", signInAgain.data.session?.access_token), routeContext));
    assert.equal(refreshedList.data?.records?.[0]?.done, true, "Stored update did not survive logout/login");

    const deleteResponse = await DELETE(request(itemUrl, "DELETE", signInAgain.data.session?.access_token), itemContext);
    assert.equal(deleteResponse.status, 200);
    const afterDelete = await payload(await GET(request(collectionUrl, "GET", signInAgain.data.session?.access_token), routeContext));
    assert.equal(afterDelete.data?.total, 0);
  } finally {
    for (const client of clients) await client.auth.signOut().catch(() => undefined);
    for (const userId of userIds) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    localProjectStore.remove(projectId);
    await durableProjectStore.remove(projectId, tenantId).catch(() => undefined);
  }
});

test("public generated apps receive refresh-stable owner-scoped guest persistence", {
  skip: durablePersistenceConfigured() ? false : "Durable persistence is unavailable",
}, async () => {
  const suffix = randomUUID();
  const projectId = `guest-qualification-${suffix}`;
  const tenantId = randomUUID();
  localProjectStore.create({ projectId, tenantId, description: "Generated guest persistence qualification" });
  const record = localProjectStore.getRecord(projectId);
  assert.ok(record);
  await durableProjectStore.saveDeployment(record, [
    { path: "index.html", content: Buffer.from("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>") },
  ]);

  const rootContext: RouteContext = { params: Promise.resolve({ projectId }) };
  const rootUrl = `https://builder.example.test/api/preview/${projectId}/`;
  const collectionUrl = `${rootUrl}__bigbag/data/tasks`;
  const dataContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "data", "tasks"] }) };
  try {
    const firstDocument = await GET(request(rootUrl, "GET", undefined, undefined, { accept: "text/html" }), rootContext);
    assert.equal(firstDocument.status, 200);
    const firstHtml = await firstDocument.text();
    const firstCapability = JSON.parse(firstHtml.match(/__BIGBAG_GUEST_CAPABILITY__=("[^"]+")/)?.[1] || "null") as string | null;
    const setCookie = firstDocument.headers.get("set-cookie") || "";
    const cookie = setCookie.split(";")[0];
    assert.ok(firstCapability && cookie, "Preview did not issue a guest identity");

    const authStorageKey = `bigbag-preview-${projectId}-auth`;
    const storageUrl = `${rootUrl}__bigbag/auth/storage?key=${encodeURIComponent(authStorageKey)}`;
    const storageContext: RouteContext = {
      params: Promise.resolve({ projectId, path: ["__bigbag", "auth", "storage"] }),
    };
    const storageWrite = await POST(new NextRequest(storageUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "null",
        "x-bigbag-guest": firstCapability,
      },
      body: JSON.stringify({ value: '{"access_token":"refresh-stable"}' }),
    }), storageContext);
    assert.equal(storageWrite.status, 200);
    assert.equal(storageWrite.headers.get("access-control-allow-origin"), "null");
    assert.equal(storageWrite.headers.get("access-control-allow-credentials"), "true");
    assert.match(storageWrite.headers.get("set-cookie") || "", /SameSite=None/i);
    assert.match(storageWrite.headers.get("set-cookie") || "", /Secure/i);
    const authCookie = (storageWrite.headers.get("set-cookie") || "").match(/bigbag_preview_auth=[^;]+/)?.[0];
    assert.ok(authCookie, "Secure auth storage cookie was not issued");

    const storageRead = await GET(new NextRequest(storageUrl, {
      headers: { cookie, origin: "null", "x-bigbag-guest": firstCapability },
    }), storageContext);
    assert.deepEqual(await storageRead.json(), { value: '{"access_token":"refresh-stable"}' });

    const guestId = firstCapability.split(".")[1];
    const newerCookieToken = sealPreviewAuthStorage(projectId, guestId, authStorageKey, '{"access_token":"newer-cookie"}', Date.now() + 1);
    const newerCookieRead = await GET(new NextRequest(storageUrl, {
      headers: { cookie: `${cookie}; bigbag_preview_auth=${newerCookieToken}`, origin: "null", "x-bigbag-guest": firstCapability },
    }), storageContext);
    assert.deepEqual(await newerCookieRead.json(), { value: '{"access_token":"newer-cookie"}' });

    const newerDurableToken = sealPreviewAuthStorage(projectId, guestId, authStorageKey, '{"access_token":"newer-durable"}', Date.now() + 2);
    await durableProjectStore.writePreviewAuthStorage(projectId, guestId, authStorageKey, newerDurableToken);
    const newerDurableRead = await GET(new NextRequest(storageUrl, {
      headers: { cookie: `${cookie}; ${authCookie}`, origin: "null", "x-bigbag-guest": firstCapability },
    }), storageContext);
    assert.deepEqual(await newerDurableRead.json(), { value: '{"access_token":"newer-durable"}' });

    const originalReadPreviewAuthStorage = durableProjectStore.readPreviewAuthStorage;
    durableProjectStore.readPreviewAuthStorage = async () => { throw new Error("simulated durable read outage"); };
    try {
      const fallbackRead = await GET(new NextRequest(storageUrl, {
        headers: { cookie: `${cookie}; ${authCookie}`, origin: "null", "x-bigbag-guest": firstCapability },
      }), storageContext);
      assert.deepEqual(await fallbackRead.json(), { value: '{"access_token":"refresh-stable"}' });
    } finally {
      durableProjectStore.readPreviewAuthStorage = originalReadPreviewAuthStorage;
    }

    const originalWritePreviewAuthStorage = durableProjectStore.writePreviewAuthStorage;
    durableProjectStore.writePreviewAuthStorage = async () => { throw new Error("simulated durable write outage"); };
    try {
      const fallbackWrite = await POST(new NextRequest(storageUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: "null",
          "x-bigbag-guest": firstCapability,
        },
        body: JSON.stringify({ value: '{"access_token":"cookie-fallback"}' }),
      }), storageContext);
      assert.equal(fallbackWrite.status, 200);
      assert.match(fallbackWrite.headers.get("set-cookie") || "", /bigbag_preview_auth=/);
    } finally {
      durableProjectStore.writePreviewAuthStorage = originalWritePreviewAuthStorage;
    }

    const originalDeletePreviewAuthStorage = durableProjectStore.deletePreviewAuthStorage;
    durableProjectStore.deletePreviewAuthStorage = async () => { throw new Error("simulated durable delete outage"); };
    try {
      const failedDelete = await DELETE(new NextRequest(storageUrl, {
        method: "DELETE",
        headers: { cookie: `${cookie}; ${authCookie}`, origin: "null", "x-bigbag-guest": firstCapability },
      }), storageContext);
      assert.equal(failedDelete.status, 503);
      assert.equal(failedDelete.headers.get("set-cookie"), null, "A failed durable delete cleared the retryable auth cookie");
    } finally {
      durableProjectStore.deletePreviewAuthStorage = originalDeletePreviewAuthStorage;
    }

    durableProjectStore.readPreviewAuthStorage = async () => { throw new Error("simulated sign-out read outage"); };
    try {
      const deleteAfterReadFailure = await DELETE(new NextRequest(storageUrl, {
        method: "DELETE",
        headers: { cookie: `${cookie}; ${authCookie}`, origin: "null", "x-bigbag-guest": firstCapability },
      }), storageContext);
      assert.equal(deleteAfterReadFailure.status, 200);
      assert.match(deleteAfterReadFailure.headers.get("set-cookie") || "", /Max-Age=0/i);
    } finally {
      durableProjectStore.readPreviewAuthStorage = originalReadPreviewAuthStorage;
    }

    const localStorageWrite = await POST(new NextRequest(
      `http://localhost:3000/api/preview/${projectId}/__bigbag/auth/storage?key=${encodeURIComponent(authStorageKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: "http://localhost:3000",
          "x-bigbag-guest": firstCapability,
        },
        body: JSON.stringify({ value: '{"access_token":"local-refresh-stable"}' }),
      }
    ), storageContext);
    const localCookie = localStorageWrite.headers.get("set-cookie") || "";
    assert.match(localCookie, /SameSite=None/i);
    assert.match(localCookie, /;\s*Secure/i);

    const originalWriteForInsecureHost = durableProjectStore.writePreviewAuthStorage;
    durableProjectStore.writePreviewAuthStorage = async () => { throw new Error("simulated insecure-host durable write outage"); };
    try {
      const insecureFallback = await POST(new NextRequest(
        `http://preview.internal/api/preview/${projectId}/__bigbag/auth/storage?key=${encodeURIComponent(authStorageKey)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            origin: "null",
            "x-bigbag-guest": firstCapability,
          },
          body: JSON.stringify({ value: '{"access_token":"must-not-be-lost"}' }),
        }
      ), storageContext);
      assert.equal(insecureFallback.status, 503);
      assert.equal(insecureFallback.headers.get("set-cookie"), null);
    } finally {
      durableProjectStore.writePreviewAuthStorage = originalWriteForInsecureHost;
    }
    const mismatchedDelete = await DELETE(new NextRequest(`${rootUrl}__bigbag/auth/storage?key=other-session`, {
      method: "DELETE",
      headers: { cookie: `${cookie}; ${authCookie}`, origin: "null", "x-bigbag-guest": firstCapability },
    }), storageContext);
    assert.equal(mismatchedDelete.status, 400);
    assert.equal(mismatchedDelete.headers.get("set-cookie"), null, "A mismatched key cleared the auth cookie");

    const createdResponse = await POST(
      request(collectionUrl, "POST", undefined, { title: "Guest task" }, { "x-bigbag-guest": firstCapability }),
      dataContext
    );
    assert.equal(createdResponse.status, 201);

    const refreshedDocument = await GET(
      request(rootUrl, "GET", undefined, undefined, { accept: "text/html", cookie }),
      rootContext
    );
    const refreshedHtml = await refreshedDocument.text();
    const refreshedCapability = JSON.parse(refreshedHtml.match(/__BIGBAG_GUEST_CAPABILITY__=("[^"]+")/)?.[1] || "null") as string | null;
    assert.ok(refreshedCapability);
    const refreshedList = await payload(await GET(
      request(collectionUrl, "GET", undefined, undefined, { "x-bigbag-guest": refreshedCapability }),
      dataContext
    ));
    assert.equal(refreshedList.data?.records?.[0]?.title, "Guest task");

    const otherDocument = await GET(request(rootUrl, "GET", undefined, undefined, { accept: "text/html" }), rootContext);
    const otherHtml = await otherDocument.text();
    const otherCapability = JSON.parse(otherHtml.match(/__BIGBAG_GUEST_CAPABILITY__=("[^"]+")/)?.[1] || "null") as string | null;
    assert.ok(otherCapability && otherCapability !== firstCapability);
    const crossGuestRead = await GET(new NextRequest(storageUrl, {
      headers: { cookie: authCookie, origin: "null", "x-bigbag-guest": otherCapability },
    }), storageContext);
    assert.deepEqual(await crossGuestRead.json(), { value: null }, "A second guest could read the first guest's auth session");
    const otherList = await payload(await GET(
      request(collectionUrl, "GET", undefined, undefined, { "x-bigbag-guest": otherCapability }),
      dataContext
    ));
    assert.equal(otherList.data?.total, 0, "A second guest could read the first guest's records");

    const matchingDelete = await DELETE(new NextRequest(storageUrl, {
      method: "DELETE",
      headers: { cookie: `${cookie}; ${authCookie}`, origin: "null", "x-bigbag-guest": firstCapability },
    }), storageContext);
    assert.match(matchingDelete.headers.get("set-cookie") || "", /bigbag_preview_auth=;/);
  } finally {
    localProjectStore.remove(projectId);
    await durableProjectStore.remove(projectId, tenantId).catch(() => undefined);
  }
});
