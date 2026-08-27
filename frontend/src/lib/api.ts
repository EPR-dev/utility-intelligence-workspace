import type { Bundle } from "./types";

export const API = process.env.NEXT_PUBLIC_API_URL || "";

export async function fetchBundle(networkId = "endeavour-energy"): Promise<Bundle> {
  const r = await fetch(`${API}/api/networks/${networkId}/bundle`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function layerUrl(name: string, networkId = "endeavour-energy") {
  return `${API}/api/networks/${networkId}/layers/${name}`;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function postBrief(format: "markdown" | "html", networkId = "endeavour-energy") {
  const r = await fetch(`${API}/api/brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ networkId, format }),
  });
  if (!r.ok) throw new Error(await r.text());
  return format === "html" ? r.text() : r.text();
}

export async function uploadReadiness(file: File, datasetKind: string, useCase: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("datasetKind", datasetKind);
  fd.append("useCase", useCase);
  const r = await fetch(`${API}/api/readiness/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
