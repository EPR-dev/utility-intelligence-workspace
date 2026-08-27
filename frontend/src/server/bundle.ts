import { readFile } from "node:fs/promises";
import path from "node:path";

export type JsonMap = Record<string, unknown>;

export async function loadBundle(networkId = "endeavour-energy"): Promise<JsonMap> {
  const file = path.join(process.cwd(), "public", "data", networkId, "bundle.json");
  try {
    return JSON.parse(await readFile(file, "utf8")) as JsonMap;
  } catch {
    throw new Error(`No processed bundle for ${networkId}`);
  }
}

export function postcodeRecord(bundle: JsonMap, postcode: string | null | undefined): JsonMap | null {
  if (!postcode) return null;
  const list = (bundle.postcodes as JsonMap[]) || [];
  return list.find((p) => p.postcode === postcode) ?? null;
}
