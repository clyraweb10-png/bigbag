import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { AUTH_COOKIE, createAuthSession } from "../src/lib/auth-session";

const { GET, POST, PATCH, DELETE, OPTIONS } = require("../src/app/api/preview/[projectId]/[[...path]]/route") as typeof import("../src/app/api/preview/[projectId]/[[...path]]/route");
const { durablePersistenceConfigured, durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const { localProjectStore } = require("../src/lib/local-orchestrator/project-store") as typeof import("../src/lib/local-orchestrator/project-store");
const { createPreviewGuestCapability, createPreviewWriteCapability, sealPreviewAuthStorage } = require("../src/lib/local-orchestrator/tenant-context") as typeof import("../src/lib/local-orchestrator/tenant-context");
const { tenantContextForIdentity } = require("../src/lib/local-orchestrator/tenant-context") as typeof import("../src/lib/local-orchestrator/tenant-context");

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

test("commerce catalogue is shared while product writes and payment status stay server-authorized", {
  skip: credentialedAuthConfigured ? false : "Credentialed Supabase configuration is unavailable",
}, async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const projectId = `commerce-qualification-${randomUUID()}`;
  const identities = [0, 1].map((index) => ({
    email: `commerce-qualification-${index}-${randomUUID()}@invalid.test`,
    password: `Q!${randomUUID()}a9`,
  }));
  const users: string[] = [];
  let tenantId = "";
  try {
    for (const identity of identities) {
      const created = await admin.auth.admin.createUser({ ...identity, email_confirm: true });
      assert.ifError(created.error);
      assert.ok(created.data.user);
      users.push(created.data.user.id);
    }
    tenantId = tenantContextForIdentity(users[0]).tenantId;
    localProjectStore.create({ projectId, tenantId, description: "Commerce authorization qualification" });
    localProjectStore.update(projectId, { commerceEnabled: true, sharedCatalogCollections: ["events", "courses"], requiresEndUserAuth: true });
    await localProjectStore.flush(projectId);
    const tokens: string[] = [];
    for (const identity of identities) {
      const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await client.auth.signInWithPassword(identity);
      assert.ifError(signed.error);
      assert.ok(signed.data.session);
      tokens.push(signed.data.session.access_token);
    }
    const context = (collection: string, recordId?: string): RouteContext => ({
      params: Promise.resolve({ projectId, path: ["__bigbag", "data", collection, ...(recordId ? [recordId] : [])] }),
    });
    const endpoint = (collection: string, recordId?: string) =>
      `https://builder.example.test/api/preview/${projectId}/__bigbag/data/${collection}${recordId ? `/${recordId}` : ""}`;
    const created = await POST(request(endpoint("products"), "POST", tokens[0], {
      name: "Synthetic tote", priceCents: 7900, active: true,
      variants: [{ id: "linen", color: "Natural", size: "One Size", stock: 2 }],
    }), context("products"));
    assert.equal(created.status, 201);
    const product = (await payload(created)).data;
    const buyerCatalog = await GET(request(endpoint("products"), "GET", tokens[1]), context("products"));
    assert.equal(buyerCatalog.status, 200);
    assert.equal((await payload(buyerCatalog)).data.records.length, 1);
    const deniedProduct = await POST(request(endpoint("products"), "POST", tokens[1], { name: "Unauthorized" }), context("products"));
    assert.equal(deniedProduct.status, 403);
    const eventCreated = await POST(request(endpoint("events"), "POST", tokens[0], {
      title: "Synthetic community event", published: true,
    }), context("events"));
    assert.equal(eventCreated.status, 201);
    const buyerEvents = await GET(request(endpoint("events"), "GET", tokens[1]), context("events"));
    assert.equal((await payload(buyerEvents)).data.records.length, 1);
    const deniedEvent = await POST(request(endpoint("events"), "POST", tokens[1], { title: "Unauthorized" }), context("events"));
    assert.equal(deniedEvent.status, 403);
    const draftEvent = await POST(request(endpoint("events"), "POST", tokens[0], {
      title: "Private draft", published: false,
    }), context("events"));
    assert.equal(draftEvent.status, 201);
    const draftId = (await payload(draftEvent)).data._id;
    const ownerEvents = await GET(request(endpoint("events"), "GET", tokens[0]), context("events"));
    assert.equal((await payload(ownerEvents)).data.total, 2);
    const buyerPublishedOnly = await GET(request(endpoint("events"), "GET", tokens[1]), context("events"));
    assert.equal((await payload(buyerPublishedOnly)).data.total, 1);
    const buyerDraftRead = await GET(request(endpoint("events", draftId), "GET", tokens[1]), context("events", draftId));
    assert.equal(buyerDraftRead.status, 404);
    const guestA = createPreviewGuestCapability(projectId, randomUUID());
    const guestB = createPreviewGuestCapability(projectId, randomUUID());
    const guestCart = await POST(request(endpoint("carts"), "POST", undefined, { items: [{ productId: product._id, variantId: "linen", qty: 1 }] }, { "x-bigbag-guest": guestA }), context("carts"));
    assert.equal(guestCart.status, 201);
    const guestCartList = await GET(request(endpoint("carts"), "GET", undefined, undefined, { "x-bigbag-guest": guestA }), context("carts"));
    assert.equal((await payload(guestCartList)).data.records.length, 1);
    const otherGuestCartList = await GET(request(endpoint("carts"), "GET", undefined, undefined, { "x-bigbag-guest": guestB }), context("carts"));
    assert.equal((await payload(otherGuestCartList)).data.records.length, 0);
    const guestOrder = await POST(request(endpoint("orders"), "POST", undefined, { items: [{ productId: product._id, variantId: "linen", qty: 1 }] }, { "x-bigbag-guest": guestA }), context("orders"));
    assert.equal(guestOrder.status, 401);
    const claimContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "commerce", "claim-cart"] }) };
    const claimUrl = `https://builder.example.test/api/preview/${projectId}/__bigbag/commerce/claim-cart`;
    assert.equal((await POST(request(claimUrl, "POST", undefined, undefined, { "x-bigbag-guest": guestA }), claimContext)).status, 401);
    assert.equal((await POST(request(claimUrl, "POST", tokens[1]), claimContext)).status, 401);
    const claimed = await POST(request(claimUrl, "POST", tokens[1], undefined, { "x-bigbag-guest": guestA }), claimContext);
    assert.equal(claimed.status, 200);
    assert.equal((await payload(claimed)).data?.cart?.items?.[0]?.qty, 1);
    assert.equal((await payload(await GET(request(endpoint("carts"), "GET", tokens[1]), context("carts")))).data?.records?.[0]?.items?.[0]?.qty, 1);
    assert.equal((await payload(await GET(request(endpoint("carts"), "GET", undefined, undefined, { "x-bigbag-guest": guestA }), context("carts")))).data?.total, 0);
    const repeatedClaim = await POST(request(claimUrl, "POST", tokens[1], undefined, { "x-bigbag-guest": guestA }), claimContext);
    assert.equal((await payload(repeatedClaim)).data?.cart?.items?.[0]?.qty, 1, "Claiming twice must not duplicate items");
    const guestC = createPreviewGuestCapability(projectId, randomUUID());
    for (const capability of [guestB, guestC]) {
      const cart = await POST(request(endpoint("carts"), "POST", undefined,
        { items: [{ productId: product._id, variantId: "linen", qty: 1 }] },
        { "x-bigbag-guest": capability }), context("carts"));
      assert.equal(cart.status, 201);
    }
    const parallelClaims = await Promise.all([guestB, guestC].map((capability) =>
      POST(request(claimUrl, "POST", tokens[1], undefined, { "x-bigbag-guest": capability }), claimContext)));
    assert.ok(parallelClaims.every((response) => response.status === 200));
    const mergedCarts = (await payload(await GET(request(endpoint("carts"), "GET", tokens[1]), context("carts")))).data;
    assert.equal(mergedCarts?.total, 1, "Parallel claims must produce one owner cart");
    assert.equal(mergedCarts?.records?.[0]?.items?.[0]?.qty, 3);
    const order = await POST(request(endpoint("orders"), "POST", tokens[1], {
      status: "paid", subtotalCents: 1, isAdmin: true, paymentIntentId: "forged",
      items: [{ productId: product._id, variantId: "linen", name: "Forged name", unitPriceCents: 1, qty: 2 }],
    }), context("orders"));
    assert.equal(order.status, 201);
    const orderData = (await payload(order)).data;
    assert.equal(orderData.status, "pending_payment");
    assert.equal(orderData.subtotalCents, 15_800);
    assert.equal(orderData.items[0].name, "Synthetic tote");
    assert.equal(orderData.items[0].unitPriceCents, 7900);
    assert.equal("isAdmin" in orderData, false);
    assert.equal("paymentIntentId" in orderData, false);
    const ownerOrders = await GET(request(endpoint("orders"), "GET", tokens[0]), context("orders"));
    assert.equal((await payload(ownerOrders)).data.records.length, 1);
    const fakePaid = await PATCH(request(endpoint("orders", orderData._id), "PATCH", tokens[1], { status: "paid" }), context("orders", orderData._id));
    assert.equal(fakePaid.status, 403);
    const deniedDelete = await DELETE(request(endpoint("orders", orderData._id), "DELETE", tokens[1]), context("orders", orderData._id));
    assert.equal(deniedDelete.status, 403);
    const missingProduct = await POST(request(endpoint("orders"), "POST", tokens[1], {
      items: [{ productId: randomUUID(), qty: 1 }],
    }), context("orders"));
    assert.equal(missingProduct.status, 400);
    const overstock = await POST(request(endpoint("orders"), "POST", tokens[1], {
      items: [{ productId: product._id, variantId: "linen", qty: 2 }, { productId: product._id, variantId: "linen", qty: 1 }],
    }), context("orders"));
    assert.equal(overstock.status, 400);
    const planResponse = await POST(request(endpoint("plans"), "POST", tokens[0], {
      name: "Synthetic workspace", description: "Qualification plan", priceCents: 2500,
      interval: "monthly", features: ["Shared workspace"], active: true, isAdmin: true,
    }), context("plans"));
    assert.equal(planResponse.status, 201);
    const plan = (await payload(planResponse)).data;
    assert.equal("isAdmin" in plan, false);
    const buyerPlans = await GET(request(endpoint("plans"), "GET", tokens[1]), context("plans"));
    assert.equal((await payload(buyerPlans)).data.records.length, 1);
    const deniedPlan = await PATCH(request(endpoint("plans", plan._id), "PATCH", tokens[1], { priceCents: 1 }), context("plans", plan._id));
    assert.equal(deniedPlan.status, 403);
    const invalidPlan = await POST(request(endpoint("plans"), "POST", tokens[0], {
      name: "Invalid", priceCents: -1, interval: "monthly",
    }), context("plans"));
    assert.equal(invalidPlan.status, 400);
    const subscriptionResponse = await POST(request(endpoint("subscriptions"), "POST", tokens[1], {
      planId: plan._id, planName: "Forged name", priceCents: 1, interval: "yearly", status: "active",
    }), context("subscriptions"));
    assert.equal(subscriptionResponse.status, 201);
    const subscription = (await payload(subscriptionResponse)).data;
    assert.equal(subscription.planName, "Synthetic workspace");
    assert.equal(subscription.priceCents, 2500);
    assert.equal(subscription.interval, "monthly");
    assert.equal(subscription.status, "pending_payment");
    const fakeSubscriptionPayment = await PATCH(request(endpoint("subscriptions", subscription._id), "PATCH", tokens[1], { status: "active" }), context("subscriptions", subscription._id));
    assert.equal(fakeSubscriptionPayment.status, 403);
    const cancelledSubscription = await PATCH(request(endpoint("subscriptions", subscription._id), "PATCH", tokens[1], { status: "cancelled" }), context("subscriptions", subscription._id));
    assert.equal((await payload(cancelledSubscription)).data.status, "cancelled");
    const deniedSubscriptionDelete = await DELETE(request(endpoint("subscriptions", subscription._id), "DELETE", tokens[1]), context("subscriptions", subscription._id));
    assert.equal(deniedSubscriptionDelete.status, 403);
    const roleEndpoint = `https://builder.example.test/api/preview/${projectId}/__bigbag/auth/role`;
    const roleContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "auth", "role"] }) };
    const builderRole = await GET(request(roleEndpoint, "GET", undefined, undefined, {
      "x-bigbag-capability": createPreviewWriteCapability(projectId, tenantId),
    }), roleContext);
    assert.equal((await payload(builderRole)).data.role, "owner");
    const wrongTenantRole = await GET(request(roleEndpoint, "GET", undefined, undefined, {
      "x-bigbag-capability": createPreviewWriteCapability(projectId, randomUUID()),
    }), roleContext);
    assert.equal((await payload(wrongTenantRole)).data.role, "visitor");
    const ownerRole = await GET(request(roleEndpoint, "GET", tokens[0]), roleContext);
    assert.equal((await payload(ownerRole)).data.role, "owner");
    const buyerRole = await GET(request(roleEndpoint, "GET", tokens[1]), roleContext);
    assert.equal((await payload(buyerRole)).data.role, "customer");
  } finally {
    if (tenantId) {
      localProjectStore.remove(projectId);
      await durableProjectStore.remove(projectId, tenantId).catch(() => undefined);
    }
    for (const userId of users) await admin.auth.admin.deleteUser(userId);
  }
});

test("private document bytes use owner-scoped object storage instead of database JSON", {
  skip: credentialedAuthConfigured ? false : "Credentialed Supabase configuration is unavailable",
}, async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const projectId = `files-qualification-${randomUUID()}`;
  const users: string[] = [];
  let tenantId = "";
  let storedFileId = "";
  try {
    const tokens: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const identity = { email: `files-qualification-${index}-${randomUUID()}@invalid.test`, password: `Q!${randomUUID()}a9` };
      const created = await admin.auth.admin.createUser({ ...identity, email_confirm: true });
      assert.ifError(created.error);
      assert.ok(created.data.user);
      users.push(created.data.user.id);
      const signed = await createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
        .auth.signInWithPassword(identity);
      assert.ifError(signed.error);
      assert.ok(signed.data.session);
      tokens.push(signed.data.session.access_token);
    }
    tenantId = tenantContextForIdentity(users[0]).tenantId;
    localProjectStore.create({ projectId, tenantId, description: "Private file storage qualification" });
    localProjectStore.update(projectId, { privateFilesEnabled: true, requiresEndUserAuth: true });
    await localProjectStore.flush(projectId);
    const bytes = Buffer.alloc(128 * 1024, 0x41);
    const fileEndpoint = `https://builder.example.test/api/preview/${projectId}/__bigbag/files`;
    const fileContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "files"] }) };
    const upload = await POST(new NextRequest(fileEndpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens[0]}`, "content-type": "text/plain", "x-bigbag-file-name": "synthetic-notes.txt" },
      body: bytes,
    }), fileContext);
    assert.equal(upload.status, 201, JSON.stringify(await payload(upload.clone())));
    const document = (await payload(upload)).data;
    assert.equal(document.sizeBytes, bytes.length);
    assert.equal(document.name, "synthetic-notes.txt");
    assert.equal("dataUrl" in document, false);
    storedFileId = document.fileId;
    const dataContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "data", "documents"] }) };
    const dataEndpoint = `https://builder.example.test/api/preview/${projectId}/__bigbag/data/documents`;
    const metadata = await payload(await GET(request(dataEndpoint, "GET", tokens[0]), dataContext));
    assert.equal(metadata.data.total, 1);
    assert.equal("dataUrl" in metadata.data.records[0], false);
    const detailContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "files", document._id] }) };
    const detailEndpoint = `${fileEndpoint}/${document._id}`;
    const downloaded = await GET(request(detailEndpoint, "GET", tokens[0]), detailContext);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("content-disposition") || "", /attachment/);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    assert.equal((await GET(request(detailEndpoint, "GET", tokens[1]), detailContext)).status, 404);
    assert.equal((await GET(request(detailEndpoint), detailContext)).status, 401);
    assert.equal((await POST(request(dataEndpoint, "POST", tokens[0], { dataUrl: "data:text/plain;base64,QQ==" }), dataContext)).status, 403);
    assert.equal((await DELETE(request(dataEndpoint + "/" + document._id, "DELETE", tokens[0]), {
      params: Promise.resolve({ projectId, path: ["__bigbag", "data", "documents", document._id] }),
    })).status, 403);
    assert.equal((await DELETE(request(detailEndpoint, "DELETE", tokens[0]), detailContext)).status, 200);
    storedFileId = "";
    assert.equal((await GET(request(detailEndpoint, "GET", tokens[0]), detailContext)).status, 404);
  } finally {
    if (storedFileId && users[0]) await admin.storage.from("bigbag-generated-files")
      .remove([`${projectId}/${users[0]}/${storedFileId}`]).catch(() => undefined);
    localProjectStore.remove(projectId);
    if (tenantId) await durableProjectStore.remove(projectId, tenantId).catch(() => undefined);
    await Promise.all(users.map((id) => admin.auth.admin.deleteUser(id)));
  }
});

test("real-estate listings are public to read and restricted to the project owner for writes", {
  skip: credentialedAuthConfigured ? false : "Credentialed Supabase configuration is unavailable",
}, async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const projectId = `listings-qualification-${randomUUID()}`;
  const users: string[] = [];
  const emails: string[] = [];
  let tenantId = "";
  try {
    const tokens: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const identity = { email: `listing-qualification-${index}-${randomUUID()}@invalid.test`, password: `Q!${randomUUID()}a9` };
      const created = await admin.auth.admin.createUser({ ...identity, email_confirm: true });
      assert.ifError(created.error);
      assert.ok(created.data.user);
      users.push(created.data.user.id);
      emails.push(identity.email);
      const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await client.auth.signInWithPassword(identity);
      assert.ifError(signed.error);
      assert.ok(signed.data.session);
      tokens.push(signed.data.session.access_token);
    }
    tenantId = tenantContextForIdentity(users[0]).tenantId;
    localProjectStore.create({ projectId, tenantId, description: "Public property listings qualification" });
    localProjectStore.update(projectId, { sharedCatalogCollections: ["listings"], requiresEndUserAuth: true });
    await localProjectStore.flush(projectId);
    const context: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "data", "listings"] }) };
    const endpoint = `https://builder.example.test/api/preview/${projectId}/__bigbag/data/listings`;
    const created = await POST(request(endpoint, "POST", tokens[0], { title: "Synthetic townhome", city: "Harbor City", priceCents: 34500000, published: true }), context);
    assert.equal(created.status, 201);
    const listing = (await payload(created)).data;
    assert.ok(listing?._id);
    const publicList = await GET(request(endpoint, "GET", undefined, undefined, {
      "x-bigbag-guest": createPreviewGuestCapability(projectId, randomUUID()),
    }), context);
    assert.equal(publicList.status, 200);
    assert.equal((await payload(publicList)).data.records[0].title, "Synthetic townhome");
    const draft = await POST(request(endpoint, "POST", tokens[0], { title: "Unpublished loft", city: "Harbor City", published: false }), context);
    assert.equal(draft.status, 201);
    const visibleAfterDraft = await payload(await GET(request(endpoint, "GET", undefined, undefined, {
      "x-bigbag-guest": createPreviewGuestCapability(projectId, randomUUID()),
    }), context));
    assert.equal(visibleAfterDraft.data.total, 1, "A guest could read an unpublished property");
    const deniedCreate = await POST(request(endpoint, "POST", tokens[1], { title: "Forged listing" }), context);
    assert.equal(deniedCreate.status, 403);
    const deniedEditContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "data", "listings", listing._id] }) };
    const deniedEdit = await PATCH(request(`${endpoint}/${listing._id}`, "PATCH", tokens[1], { title: "Forged edit" }), deniedEditContext);
    assert.equal(deniedEdit.status, 403);
    const inquiriesEndpoint = `https://builder.example.test/api/preview/${projectId}/__bigbag/data/inquiries`;
    const inquiriesContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "data", "inquiries"] }) };
    const guestInquiry = await POST(request(inquiriesEndpoint, "POST", undefined, {
      listingId: listing._id, name: "Guest", message: "Please arrange a viewing next week",
    }, { "x-bigbag-guest": createPreviewGuestCapability(projectId, randomUUID()) }), inquiriesContext);
    assert.equal(guestInquiry.status, 401);
    const buyerInquiry = await POST(request(inquiriesEndpoint, "POST", tokens[1], {
      listingId: listing._id, listingTitle: "Forged property", name: "Interested Buyer",
      email: "forged@invalid.test", status: "delivered", message: "Please arrange a viewing next week",
    }), inquiriesContext);
    assert.equal(buyerInquiry.status, 201);
    const savedInquiry = (await payload(buyerInquiry)).data;
    assert.equal(savedInquiry.listingTitle, listing.title);
    assert.equal(savedInquiry.email, emails[1]);
    assert.equal(savedInquiry.status, "unread");
    const ownerInquiries = await payload(await GET(request(inquiriesEndpoint, "GET", tokens[0]), inquiriesContext));
    assert.equal(ownerInquiries.data.total, 1);
    const otherBuyerInquiries = await payload(await GET(request(inquiriesEndpoint, "GET", tokens[2]), inquiriesContext));
    assert.equal(otherBuyerInquiries.data.total, 0);
    const inquiryEditContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "data", "inquiries", savedInquiry._id] }) };
    const forgedDelivery = await PATCH(request(`${inquiriesEndpoint}/${savedInquiry._id}`, "PATCH", tokens[1], { status: "delivered" }), inquiryEditContext);
    assert.equal(forgedDelivery.status, 403);
  } finally {
    localProjectStore.remove(projectId);
    if (tenantId) await durableProjectStore.remove(projectId, tenantId).catch(() => undefined);
    await Promise.all(users.map((id) => admin.auth.admin.deleteUser(id)));
  }
});

test("booking services are public and simultaneous customers cannot reserve an overlapping slot", {
  skip: credentialedAuthConfigured ? false : "Credentialed Supabase configuration is unavailable",
}, async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const projectId = `booking-qualification-${randomUUID()}`;
  const identities = [0, 1, 2].map((index) => ({
    email: `booking-qualification-${index}-${randomUUID()}@invalid.test`,
    password: `Q!${randomUUID()}a9`,
  }));
  const users: string[] = [];
  let tenantId = "";
  try {
    for (const identity of identities) {
      const created = await admin.auth.admin.createUser({ ...identity, email_confirm: true });
      assert.ifError(created.error);
      assert.ok(created.data.user);
      users.push(created.data.user.id);
    }
    tenantId = tenantContextForIdentity(users[0]).tenantId;
    localProjectStore.create({ projectId, tenantId, description: "Booking authorization qualification" });
    localProjectStore.update(projectId, { sharedCatalogCollections: ["services"], requiresEndUserAuth: true });
    await localProjectStore.flush(projectId);
    const tokens: string[] = [];
    for (const identity of identities) {
      const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signed = await client.auth.signInWithPassword(identity);
      assert.ifError(signed.error);
      assert.ok(signed.data.session);
      tokens.push(signed.data.session.access_token);
    }
    const context = (collection: string, recordId?: string): RouteContext => ({
      params: Promise.resolve({ projectId, path: ["__bigbag", "data", collection, ...(recordId ? [recordId] : [])] }),
    });
    const endpoint = (collection: string, recordId?: string) =>
      `https://builder.example.test/api/preview/${projectId}/__bigbag/data/${collection}${recordId ? `/${recordId}` : ""}`;
    const serviceResponse = await POST(request(endpoint("services"), "POST", tokens[0], {
      name: "Synthetic consultation", durationMinutes: 30, priceCents: 4500,
    }), context("services"));
    assert.equal(serviceResponse.status, 201);
    const service = (await payload(serviceResponse)).data;
    const guestCatalog = await GET(request(endpoint("services"), "GET", undefined, undefined, {
      "x-bigbag-guest": createPreviewGuestCapability(projectId, randomUUID()),
    }), context("services"));
    assert.equal(guestCatalog.status, 200);
    assert.equal((await payload(guestCatalog)).data.total, 1);
    const unauthorizedService = await POST(request(endpoint("services"), "POST", tokens[1], {
      name: "Forged service", durationMinutes: 30,
    }), context("services"));
    assert.equal(unauthorizedService.status, 403);
    const booking = (startMinutes: number) => ({
      serviceId: service._id, date: "2030-04-02", startMinutes,
      durationMinutes: 1, serviceName: "Forged name", status: "paid",
    });
    const simultaneous = await Promise.all([
      POST(request(endpoint("bookings"), "POST", tokens[1], booking(600)), context("bookings")),
      POST(request(endpoint("bookings"), "POST", tokens[2], booking(615)), context("bookings")),
    ]);
    assert.deepEqual(simultaneous.map((response) => response.status).sort(), [201, 409]);
    const winner = simultaneous.findIndex((response) => response.status === 201);
    const winningUser = winner === 0 ? 1 : 2;
    const losingUser = winner === 0 ? 2 : 1;
    const createdBooking = (await payload(simultaneous[winner])).data;
    assert.equal(createdBooking.status, "confirmed");
    assert.equal(createdBooking.durationMinutes, 30);
    assert.equal(createdBooking.serviceName, "Synthetic consultation");
    const loserList = await GET(request(endpoint("bookings"), "GET", tokens[losingUser]), context("bookings"));
    assert.equal((await payload(loserList)).data.total, 0);
    const incompleteReschedule = await PATCH(request(endpoint("bookings", createdBooking._id), "PATCH", tokens[winningUser], {
      startMinutes: 660,
    }), context("bookings", createdBooking._id));
    assert.equal(incompleteReschedule.status, 403);
    const rescheduled = await PATCH(request(endpoint("bookings", createdBooking._id), "PATCH", tokens[winningUser], {
      date: "2030-04-02", startMinutes: 660,
    }), context("bookings", createdBooking._id));
    assert.equal(rescheduled.status, 200);
    assert.equal((await payload(rescheduled)).data.startMinutes, 660);
    const otherBooking = await POST(request(endpoint("bookings"), "POST", tokens[losingUser], booking(600)), context("bookings"));
    assert.equal(otherBooking.status, 201);
    const otherBookingId = (await payload(otherBooking)).data._id;
    const overlappingReschedule = await PATCH(request(endpoint("bookings", createdBooking._id), "PATCH", tokens[winningUser], {
      date: "2030-04-02", startMinutes: 615,
    }), context("bookings", createdBooking._id));
    assert.equal(overlappingReschedule.status, 409);
    const forgedReschedule = await PATCH(request(endpoint("bookings", createdBooking._id), "PATCH", tokens[losingUser], {
      date: "2030-04-02", startMinutes: 720,
    }), context("bookings", createdBooking._id));
    assert.equal(forgedReschedule.status, 404);
    const cancelled = await PATCH(request(endpoint("bookings", createdBooking._id), "PATCH", tokens[winningUser], {
      status: "cancelled",
    }), context("bookings", createdBooking._id));
    assert.equal((await payload(cancelled)).data.status, "cancelled");
    const retried = await POST(request(endpoint("bookings"), "POST", tokens[losingUser], booking(660)), context("bookings"));
    assert.equal(retried.status, 201);
    const deniedDelete = await DELETE(request(endpoint("bookings", otherBookingId), "DELETE", tokens[losingUser]), context("bookings", otherBookingId));
    assert.equal(deniedDelete.status, 403);
  } finally {
    for (const userId of users) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    localProjectStore.remove(projectId);
    if (tenantId) await durableProjectStore.remove(projectId, tenantId).catch(() => undefined);
  }
});

test("restaurant tables are public but reservation capacity is enforced across customers", {
  skip: credentialedAuthConfigured ? false : "Credentialed Supabase configuration is unavailable",
}, async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const projectId = `restaurant-qualification-${randomUUID()}`;
  const identities = [0, 1, 2].map((index) => ({
    email: `restaurant-qualification-${index}-${randomUUID()}@invalid.test`,
    password: `Q!${randomUUID()}a9`,
  }));
  const users: string[] = [];
  let tenantId = "";
  try {
    for (const identity of identities) {
      const created = await admin.auth.admin.createUser({ ...identity, email_confirm: true });
      assert.ifError(created.error);
      assert.ok(created.data.user);
      users.push(created.data.user.id);
    }
    tenantId = tenantContextForIdentity(users[0]).tenantId;
    localProjectStore.create({ projectId, tenantId, description: "Restaurant capacity qualification" });
    localProjectStore.update(projectId, { sharedCatalogCollections: ["tables"], requiresEndUserAuth: true });
    await localProjectStore.flush(projectId);
    const tokens: string[] = [];
    for (const identity of identities) {
      const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signed = await client.auth.signInWithPassword(identity);
      assert.ifError(signed.error);
      assert.ok(signed.data.session);
      tokens.push(signed.data.session.access_token);
    }
    const context = (collection: string, recordId?: string): RouteContext => ({
      params: Promise.resolve({ projectId, path: ["__bigbag", "data", collection, ...(recordId ? [recordId] : [])] }),
    });
    const endpoint = (collection: string, recordId?: string) =>
      `https://builder.example.test/api/preview/${projectId}/__bigbag/data/${collection}${recordId ? `/${recordId}` : ""}`;
    const table = await POST(request(endpoint("tables"), "POST", tokens[0], {
      name: "Synthetic table", seats: 2, location: "Window",
    }), context("tables"));
    assert.equal(table.status, 201);
    const guestTables = await GET(request(endpoint("tables"), "GET", undefined, undefined, {
      "x-bigbag-guest": createPreviewGuestCapability(projectId, randomUUID()),
    }), context("tables"));
    assert.equal(guestTables.status, 200);
    assert.equal((await payload(guestTables)).data.total, 1);
    const forgedTable = await POST(request(endpoint("tables"), "POST", tokens[1], {
      name: "Forged", seats: 200,
    }), context("tables"));
    assert.equal(forgedTable.status, 403);
    const reservedDate = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const reservation = (time: string) => ({
      date: reservedDate, time, partySize: 2,
      guestName: "Synthetic guest", guestEmail: "synthetic@example.test", status: "paid",
    });
    const simultaneous = await Promise.all([
      POST(request(endpoint("reservations"), "POST", tokens[1], reservation("17:00")), context("reservations")),
      POST(request(endpoint("reservations"), "POST", tokens[2], reservation("17:30")), context("reservations")),
    ]);
    assert.deepEqual(simultaneous.map((response) => response.status).sort(), [201, 409]);
    const winner = simultaneous.findIndex((response) => response.status === 201);
    const winningUser = winner === 0 ? 1 : 2;
    const losingUser = winner === 0 ? 2 : 1;
    const saved = (await payload(simultaneous[winner])).data;
    assert.equal(saved.status, "confirmed");
    assert.equal(saved.durationMinutes, 120);
    assert.equal(typeof saved.tableId, "string");
    const aliasConflict = await POST(request(endpoint("table_reservations"), "POST", tokens[losingUser], reservation("17:45")), context("table_reservations"));
    assert.equal(aliasConflict.status, 409, "Reservation aliases must share the same table capacity");
    const guestSlots = await GET(request(endpoint("reservation_slots"), "GET", undefined, undefined, {
      "x-bigbag-guest": createPreviewGuestCapability(projectId, randomUUID()),
    }), context("reservation_slots"));
    assert.equal(guestSlots.status, 200);
    const publishedSlots = (await payload(guestSlots)).data.records;
    assert.equal(publishedSlots.length, 1);
    assert.equal(publishedSlots[0].guestEmail, undefined);
    assert.equal(publishedSlots[0].guestName, undefined);
    const ownerReservations = await GET(request(endpoint("reservations"), "GET", tokens[0]), context("reservations"));
    assert.equal(ownerReservations.status, 200);
    assert.equal((await payload(ownerReservations)).data.total, 1);
    const forgedSlot = await POST(request(endpoint("reservation_slots"), "POST", tokens[0], {
      date: reservedDate, time: "17:00",
    }), context("reservation_slots"));
    assert.equal(forgedSlot.status, 405);
    const loserList = await GET(request(endpoint("reservations"), "GET", tokens[losingUser]), context("reservations"));
    assert.equal((await payload(loserList)).data.total, 0);
    const forgedCancel = await PATCH(request(endpoint("reservations", saved._id), "PATCH", tokens[losingUser], {
      status: "cancelled",
    }), context("reservations", saved._id));
    assert.equal(forgedCancel.status, 404);
    const cancelled = await PATCH(request(endpoint("reservations", saved._id), "PATCH", tokens[winningUser], {
      status: "cancelled",
    }), context("reservations", saved._id));
    assert.equal(cancelled.status, 200);
    const aliasBooked = await POST(request(endpoint("table_reservations"), "POST", tokens[losingUser], reservation("17:30")), context("table_reservations"));
    assert.equal(aliasBooked.status, 201);
    const aliasRecord = (await payload(aliasBooked)).data;
    const legacyConflict = await POST(request(endpoint("reservations"), "POST", tokens[winningUser], reservation("17:45")), context("reservations"));
    assert.equal(legacyConflict.status, 409, "Legacy reservations must respect alias bookings");
    const aliasSlots = await GET(request(endpoint("reservation_slots"), "GET", undefined, undefined, {
      "x-bigbag-guest": createPreviewGuestCapability(projectId, randomUUID()),
    }), context("reservation_slots"));
    assert.equal((await payload(aliasSlots)).data.records.some((entry: { _id: string }) => entry._id === aliasRecord._id), true);
    const aliasOwner = await GET(request(endpoint("table_reservations"), "GET", tokens[losingUser]), context("table_reservations"));
    assert.equal((await payload(aliasOwner)).data.total, 1);
    const aliasOther = await GET(request(endpoint("table_reservations"), "GET", tokens[winningUser]), context("table_reservations"));
    assert.equal((await payload(aliasOther)).data.total, 0);
    const aliasCancelled = await PATCH(request(endpoint("table_reservations", aliasRecord._id), "PATCH", tokens[losingUser], {
      status: "cancelled",
    }), context("table_reservations", aliasRecord._id));
    assert.equal(aliasCancelled.status, 200);
    const retried = await POST(request(endpoint("reservations"), "POST", tokens[losingUser], reservation("17:30")), context("reservations"));
    assert.equal(retried.status, 201);
    const deniedDelete = await DELETE(request(endpoint("reservations", saved._id), "DELETE", tokens[winningUser]), context("reservations", saved._id));
    assert.equal(deniedDelete.status, 403);
    const pastMidnight = await POST(request(endpoint("table_reservations"), "POST", tokens[winningUser], reservation("23:30")), context("table_reservations"));
    assert.equal(pastMidnight.status, 400);
    const endingAtMidnight = await POST(request(endpoint("table_reservations"), "POST", tokens[winningUser], reservation("22:00")), context("table_reservations"));
    assert.equal(endingAtMidnight.status, 201);
  } finally {
    for (const userId of users) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    localProjectStore.remove(projectId);
    if (tenantId) await durableProjectStore.remove(projectId, tenantId).catch(() => undefined);
  }
});

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
    const projectRoleContext: RouteContext = { params: Promise.resolve({ projectId, path: ["__bigbag", "auth", "role"] }) };
    const projectRoleUrl = `https://builder.example.test/api/preview/${projectId}/__bigbag/auth/role`;
    const visitorRole = await GET(request(projectRoleUrl), projectRoleContext);
    assert.equal((await payload(visitorRole)).data?.role, "visitor", "Non-commerce projects expose a safe visitor role");
    const rolePreflight = await OPTIONS(request(projectRoleUrl, "OPTIONS", undefined, undefined, {
      origin: "https://preview.example.test",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    }), projectRoleContext);
    assert.equal(rolePreflight.status, 204);
    assert.match(rolePreflight.headers.get("access-control-allow-headers") || "", /authorization/i);

    const sessions = [];
    for (let index = 0; index < clients.length; index += 1) {
      const signIn = await clients[index].auth.signInWithPassword({ email: emails[index], password: passwords[index] });
      assert.ifError(signIn.error);
      assert.ok(signIn.data.session?.access_token, "Supabase login did not return a session");
      sessions.push(signIn.data.session.access_token);
    }
    const signedProjectRole = await GET(request(projectRoleUrl, "GET", sessions[0]), projectRoleContext);
    assert.equal((await payload(signedProjectRole)).data?.role, "customer", "Non-commerce apps can resolve verified account roles");

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
    const builderOnly = await POST(request(collectionUrl, "POST", undefined, { title: "Still denied" }, {
      "x-bigbag-capability": createPreviewWriteCapability(projectId, tenantId),
    }), routeContext);
    assert.equal(builderOnly.status, 401, "A builder capability bypassed required end-user authentication");

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
  const builderUserId = randomUUID();
  const tenantId = tenantContextForIdentity(builderUserId).tenantId;
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

    const ownerBrowsingNormally = await GET(request(rootUrl, "GET", undefined, undefined, {
      accept: "text/html",
      cookie: `${AUTH_COOKIE}=${createAuthSession(builderUserId)}`,
    }), rootContext);
    const ownerBrowsingHtml = await ownerBrowsingNormally.text();
    assert.match(ownerBrowsingHtml, /__BIGBAG_GUEST_CAPABILITY__/);
    assert.doesNotMatch(ownerBrowsingHtml, /__BIGBAG_WRITE_CAPABILITY__/, "Ordinary previews must not override guest cart access with an editor capability");

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
