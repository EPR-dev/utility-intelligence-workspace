export function hasWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

export type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

export const ENDEAVOUR_BBOX: BBox = { minLon: 149.55, minLat: -35.72, maxLon: 151.22, maxLat: -32.22 };

export function scoreFill(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  if (s < 40) return "#1f6d68";
  if (s < 55) return "#2e8a7e";
  if (s < 70) return "#4aa39a";
  if (s < 85) return "#c4a35a";
  return "#e4c37a";
}

export function project(lon: number, lat: number, bbox: BBox, w: number, h: number, pad = 28): [number, number] {
  const x = pad + ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * (w - pad * 2);
  const y = pad + (1 - (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * (h - pad * 2);
  return [x, y];
}

export type Ring = [number, number][];

export function ringsFromGeometry(geom: GeoJSON.Geometry | null | undefined): Ring[] {
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates.map((r) => r.map(([lon, lat]) => [lon, lat] as [number, number]));
  if (geom.type === "MultiPolygon") {
    return geom.coordinates.flatMap((poly) => poly.map((r) => r.map(([lon, lat]) => [lon, lat] as [number, number])));
  }
  return [];
}

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
