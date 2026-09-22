import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const { classifyIntent } = require("../src/lib/local-orchestrator/intent-router") as typeof import("../src/lib/local-orchestrator/intent-router");
const { publicModelName } = require("../src/lib/local-orchestrator/multi-model-router") as typeof import("../src/lib/local-orchestrator/multi-model-router");

interface StressCase {
  number: number;
  section: string;
  text: string;
}

function stressCases(): StressCase[] {
  const source = fs.readFileSync(
    path.join(process.cwd(), "tests/fixtures/bigbag-100-stress-test.md"),
    "utf8"
  );
  const cases: StressCase[] = [];
  let section = "";
  let current: StressCase | null = null;

  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("## How to use")) {
      if (current) cases.push(current);
      current = null;
      break;
    }
    const heading = /^## ([A-M])\.\s+(.+)$/.exec(line);
    if (heading) {
      section = `${heading[1]}. ${heading[2]}`;
      continue;
    }
    const start = /^(\d{1,3})\.\s+(.+)$/.exec(line);
    if (start) {
      if (current) cases.push(current);
      current = { number: Number(start[1]), section, text: start[2].trim() };
      continue;
    }
    if (current && line.trim() && !line.startsWith("## ")) {
      current.text += ` ${line.trim()}`;
    }
  }
  if (current) cases.push(current);
  return cases;
}

test("the supplied 100-case AI stress corpus is complete and machine-routable", () => {
  const cases = stressCases();
  assert.equal(cases.length, 100);
  assert.deepEqual(cases.map((entry) => entry.number), Array.from({ length: 100 }, (_, index) => index + 1));
  assert.ok(cases.every((entry) => entry.section && entry.text.length >= 20));

  const validIntents = new Set(["chat", "plan", "update_plan", "confirm_build"]);
  for (const entry of cases) {
    assert.ok(validIntents.has(classifyIntent(entry.text, "idle")), `Case ${entry.number} returned an invalid intent`);
  }
});

test("concrete build requests route to project setup while questions remain chat", () => {
  const buildPrompts = [
    "Build a responsive salon booking website with services, prices, staff profiles, and a warm neutral palette.",
    "Create a full-stack inventory tool with products, purchase orders, authentication, and persisted CRUD.",
    "Make a single self-contained index.html landing page for cordex with a scroll-scrubbed hero video.",
  ];
  for (const prompt of buildPrompts) assert.equal(classifyIntent(prompt, "idle"), "plan");

  assert.equal(classifyIntent("Can BigBag build a responsive dashboard?", "idle"), "chat");
  assert.equal(classifyIntent("What database options do you support?", "idle"), "chat");
});

test("customer-visible model identity is always provider-neutral", () => {
  assert.equal(publicModelName("gemini-flash"), "AI");
  assert.equal(publicModelName("telnyx-glm"), "AI");
  assert.equal(publicModelName("any-future-provider"), "AI");
});
