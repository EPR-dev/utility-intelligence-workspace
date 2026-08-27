import type { StyleSpecification } from "maplibre-gl";

export const CARTO_DARK_MATTER_GL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function cartoKey(): string {
  return process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim() ?? "";
}

function withKey(url: string): string {
  const key = cartoKey();
  if (!key) return url;
  return `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
}

/** Dark streets raster, with the Carto key so tiles are not watermarked. */
export function cartoRasterStyle(): StyleSpecification {
  const q = cartoKey() ? `?key=${encodeURIComponent(cartoKey())}` : "";
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      carto: {
        type: "raster",
        tiles: [
          `https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${q}`,
          `https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${q}`,
          `https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${q}`,
          `https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${q}`,
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors © CARTO",
      },
    },
    layers: [
      {
        id: "carto",
        type: "raster",
        source: "carto",
        paint: { "raster-opacity": 0.38, "raster-brightness-min": 0.08 },
      },
    ],
  };
}

export function resolveBrowserBasemap(): string | StyleSpecification {
  const custom = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim();
  if (custom) return custom;
  if (cartoKey()) return cartoRasterStyle();
  return withKey(CARTO_DARK_MATTER_GL);
}
