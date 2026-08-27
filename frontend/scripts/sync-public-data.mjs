import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(frontend, "..", "data", "processed");
const dest = resolve(frontend, "public", "data");

if (!existsSync(src)) {
  if (existsSync(dest)) {
    console.log("sync-public-data: using existing public/data");
    process.exit(0);
  }
  console.warn("sync-public-data: no data/processed found; run pipelines/build_network_bundle.py");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("sync-public-data: copied processed layers into public/data");
