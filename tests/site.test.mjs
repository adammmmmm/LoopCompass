import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("landing page and Pages workflow remain deployable", async () => {
  const [html, css, workflow] = await Promise.all([
    readFile(new URL("../site/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<title>LoopCompass \| Recovery governance for agent workflows<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/loopcompass\.com\/">/);
  assert.match(html, /href="styles\.css"/);
  assert.match(html, /src="brand-mark\.svg"/);
  assert.doesNotMatch(`${html}\n${css}`, /http:\/\//);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: site/);
});
