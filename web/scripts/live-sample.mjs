// Copy a rehearsal replay from ../docs/live into src/sample/live-sample.json, so the Live page's
// "Play it" can replay it in the page, also on the published copy where live/ never exists.
// Run after `triage replay ... --site docs`:  node scripts/live-sample.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const docs = fileURLToPath(new URL("../../docs/", import.meta.url));
const data = JSON.parse(readFileSync(docs + "live/data.json", "utf8"));
const bundles = {};
for (const r of data.incidents) {
  try {
    bundles[r.bundle] = JSON.parse(readFileSync(docs + r.bundle, "utf8"));
  } catch {
    /* a row without its bundle shows "isn't in the files" */
  }
}
const out = fileURLToPath(new URL("../src/sample/live-sample.json", import.meta.url));
writeFileSync(out, JSON.stringify({ data, bundles }));
console.log(`wrote ${data.incidents.length} rows and ${Object.keys(bundles).length} bundles for ${data.robot_id}`);
