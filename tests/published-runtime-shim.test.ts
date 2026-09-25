import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { PREVIEW_RUNTIME_SHIM } from "../src/lib/visual-edit-agent";

test("published assets stay frozen while generated auth and data use the project API", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://builder.example.test/api/preview/demo/__published/",
    runScripts: "outside-only",
  });
  try {
    const requests: string[] = [];
    dom.window.fetch = (async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    dom.window.eval(PREVIEW_RUNTIME_SHIM("/api/preview/demo/__published"));

    await dom.window.fetch("/api/preview/demo/__bigbag/auth/config");
    await dom.window.fetch("/api/preview/demo/__bigbag/data/orders");
    await dom.window.fetch("/assets/app.js");
    assert.deepEqual(requests, [
      "/api/preview/demo/__bigbag/auth/config",
      "/api/preview/demo/__bigbag/data/orders",
      "/api/preview/demo/__published/assets/app.js",
    ]);
  } finally {
    dom.window.close();
  }
});
