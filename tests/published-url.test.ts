import assert from "node:assert/strict";
import test from "node:test";
import type { VcaasProject } from "../src/lib/vcaas-types";
import { getPublishedUrl } from "../src/lib/project-status";

test("local publishing shows the stable public preview address before and after deploy", () => {
  const previous = process.env.NEXT_PUBLIC_ORCHESTRATOR_MODE;
  process.env.NEXT_PUBLIC_ORCHESTRATOR_MODE = "local";
  try {
    const origin = "https://builder.example.test";
    const expected = `${origin}/api/preview/project-1/__published/`;
    assert.equal(getPublishedUrl(null, "project-1", origin), expected);
    assert.equal(getPublishedUrl({ productionProjectUrl: expected } as VcaasProject, "project-1", origin), expected);
    assert.equal(getPublishedUrl({ productionProjectUrl: `${origin}/api/preview/project-1/` } as VcaasProject, "project-1", origin), expected);
    assert.equal(getPublishedUrl({ productionProjectUrl: "/api/preview/project-1/" } as VcaasProject, "project-1", origin), expected);
    assert.equal(getPublishedUrl({ productionProjectUrl: "javascript:alert(1)" } as VcaasProject, "project-1", origin), expected);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ORCHESTRATOR_MODE;
    else process.env.NEXT_PUBLIC_ORCHESTRATOR_MODE = previous;
  }
});

test("cloud publishing uses its project or verified custom-domain URL", () => {
  const previous = process.env.NEXT_PUBLIC_ORCHESTRATOR_MODE;
  delete process.env.NEXT_PUBLIC_ORCHESTRATOR_MODE;
  try {
    assert.equal(getPublishedUrl(null, "project-2", "https://builder.example.test"), "https://project-2.totalum-project.com");
    assert.equal(getPublishedUrl({ productionProjectUrl: "https://published.example.test/" } as VcaasProject,
      "project-2", "https://builder.example.test"), "https://published.example.test/");
    assert.equal(getPublishedUrl({ customDomain: { status: "active", hostname: "my-app.example.test" } } as VcaasProject,
      "project-2", "https://builder.example.test"), "https://my-app.example.test");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ORCHESTRATOR_MODE;
    else process.env.NEXT_PUBLIC_ORCHESTRATOR_MODE = previous;
  }
});
