import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import type { LocalProjectRecord } from "../src/lib/local-orchestrator/types";

process.env.ORCHESTRATOR_MODE = "local";
const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const { GET } = require("../src/app/api/preview/[projectId]/[[...path]]/route") as typeof import("../src/app/api/preview/[projectId]/[[...path]]/route");

test("editing preview after publish leaves the public build unchanged", async () => {
  const projectId = `publish-isolation-${randomUUID()}`;
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-publish-source-"));
  const createdAt = new Date(Date.now() - 5_000).toISOString();
  const record: LocalProjectRecord = {
    projectId, tenantId, label: "Publish isolation", description: "Test project",
    createdAt, lastModifiedAt: createdAt, port: 3001, status: "done", serverStatus: "Active",
    conversation: [], deployment: { status: "success", createdAt, versionId: randomUUID() },
  };
  const file = (value: string) => [
    { path: "index.html", content: Buffer.from(`<main>${value}</main><script type="module" src="/assets/app.js"></script>`) },
    { path: "assets/app.js", content: Buffer.from(`console.log(${JSON.stringify(value)})`) },
  ];

  try {
    await durableProjectStore.savePreview(record, file("Draft v1"));
    const beforePublish = await GET(new NextRequest(`https://builder.example.test/api/preview/${projectId}/__published/`),
      { params: Promise.resolve({ projectId, path: ["__published"] }) });
    assert.equal(beforePublish.status, 404);
    await durableProjectStore.saveDeployment(record, file("Published v1"));
    record.lastModifiedAt = new Date(Date.parse(createdAt) + 1_000).toISOString();
    await durableProjectStore.savePreview(record, file("Draft v2"));

    const previewFile = await durableProjectStore.readPreviewFile(projectId, "index.html");
    const publicFile = await durableProjectStore.readDeploymentFile(projectId, "index.html");
    assert.match(Buffer.from(previewFile!.content).toString("utf8"), /Draft v2/);
    assert.match(Buffer.from(publicFile!.content).toString("utf8"), /Published v1/);

    const preview = await GET(new NextRequest(`https://builder.example.test/api/preview/${projectId}/`),
      { params: Promise.resolve({ projectId, path: [] }) });
    const published = await GET(new NextRequest(`https://builder.example.test/api/preview/${projectId}/__published/`),
      { params: Promise.resolve({ projectId, path: ["__published"] }) });
    assert.equal(preview.status, 200);
    assert.equal(published.status, 200);
    assert.match(await preview.text(), /Draft v2/);
    const publishedHtml = await published.text();
    assert.match(publishedHtml, /Published v1/);
    assert.match(publishedHtml, new RegExp(`/api/preview/${projectId}/__published/assets/app\\.js`));

    const publicAsset = await GET(new NextRequest(`https://builder.example.test/api/preview/${projectId}/__published/assets/app.js`),
      { params: Promise.resolve({ projectId, path: ["__published", "assets", "app.js"] }) });
    assert.equal(publicAsset.status, 200);
    assert.match(await publicAsset.text(), /Published v1/);

    fs.mkdirSync(path.join(sourceRoot, "public", "uploads"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "public", "uploads", "late.svg"), "<svg>draft upload</svg>");
    record.lastModifiedAt = new Date(Date.parse(createdAt) + 2_000).toISOString();
    await durableProjectStore.saveSource(record, sourceRoot);
    const draftUpload = await GET(new NextRequest(`https://builder.example.test/api/preview/${projectId}/uploads/late.svg`),
      { params: Promise.resolve({ projectId, path: ["uploads", "late.svg"] }) });
    const publicUpload = await GET(new NextRequest(`https://builder.example.test/api/preview/${projectId}/__published/uploads/late.svg`),
      { params: Promise.resolve({ projectId, path: ["__published", "uploads", "late.svg"] }) });
    assert.equal(draftUpload.status, 200);
    assert.equal(publicUpload.status, 404);

    record.deployment = { status: "deploying", createdAt: new Date().toISOString() };
    record.lastModifiedAt = new Date(Date.parse(createdAt) + 3_000).toISOString();
    await durableProjectStore.saveRecord(record);
    const duringPublish = await GET(new NextRequest(`https://builder.example.test/api/preview/${projectId}/__published/`),
      { params: Promise.resolve({ projectId, path: ["__published"] }) });
    assert.equal(duringPublish.status, 200);
    assert.match(await duringPublish.text(), /Published v1/);
  } finally {
    await durableProjectStore.remove(projectId, tenantId);
    await durableProjectStore.closeConnections();
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});
