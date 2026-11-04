// Remove only what a previous build wrote into ../docs. The engine's files there
// (data.json, fleet.json, incidents/, live/, THRESHOLDS.md) are never touched.
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const docs = fileURLToPath(new URL("../../docs/", import.meta.url));
rmSync(docs + "assets", { recursive: true, force: true });
rmSync(docs + "app.js", { force: true });
writeFileSync(docs + ".nojekyll", "");
