"use client";

import { useEffect, useRef, useState } from "react";
import { layerUrl } from "@/lib/api";
import {
  ENDEAVOUR_BBOX,
  pointInRing,
  project,
  ringsFromGeometry,
  scoreFill,
  type BBox,
  type Ring,
} from "@/lib/geo";
import { useApp } from "@/lib/store";

type PcFeat = {
  postcode: string;
  name: string;
  rings: Ring[];
  score: number;
  props: Record<string, unknown>;
};

type Zone = { lon: number; lat: number; name: string; postcode?: string };

export function SimpleMap({ focus }: { focus?: { center: [number, number]; zoom: number } | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<{ pcs: PcFeat[]; zones: Zone[]; territory: Ring[] }>({
    pcs: [],
    zones: [],
    territory: [],
  });
  const hoverRef = useRef<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; line: string } | null>(null);

  const scoreKind = useApp((s) => s.scoreKind);
  const selected = useApp((s) => s.selectedPostcode);
  const compare = useApp((s) => s.comparePostcode);
  const showZones = useApp((s) => s.layers.zones);
  const showPostcodes = useApp((s) => s.layers.postcodes);
  const showTerritory = useApp((s) => s.layers.territory);
  const bundle = useApp((s) => s.bundle);

  const viewBbox = (): BBox => {
    if (!focus) return ENDEAVOUR_BBOX;
    const spanLon = ENDEAVOUR_BBOX.maxLon - ENDEAVOUR_BBOX.minLon;
    const spanLat = ENDEAVOUR_BBOX.maxLat - ENDEAVOUR_BBOX.minLat;
    const k = Math.pow(2, 8.4 - focus.zoom);
    const lonSpan = (spanLon * k) / 2;
    const latSpan = (spanLat * k) / 2;
    return {
      minLon: focus.center[0] - lonSpan,
      maxLon: focus.center[0] + lonSpan,
      minLat: focus.center[1] - latSpan,
      maxLat: focus.center[1] + latSpan,
    };
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pcRes, zRes, tRes] = await Promise.all([
          fetch(layerUrl("postcodes")),
          fetch(layerUrl("zone_substations")),
          fetch(layerUrl("territory")),
        ]);
        const pcGj = pcRes.ok ? await pcRes.json() : { features: [] };
        const zGj = zRes.ok ? await zRes.json() : { features: [] };
        const tGj = tRes.ok ? await tRes.json() : { features: [] };
        if (cancelled) return;
        const pcs: PcFeat[] = (pcGj.features || []).map((f: GeoJSON.Feature) => {
          const p = (f.properties || {}) as Record<string, unknown>;
          return {
            postcode: String(p.postcode ?? ""),
            name: String(p.name ?? p.postcode ?? ""),
            rings: ringsFromGeometry(f.geometry),
            score: Number(p[scoreKind] ?? p.composite ?? 0),
            props: p,
          };
        });
        const zones: Zone[] = (zGj.features || [])
          .map((f: GeoJSON.Feature) => {
            const g = f.geometry;
            if (!g || g.type !== "Point") return null;
            const p = (f.properties || {}) as Record<string, unknown>;
            return {
              lon: g.coordinates[0],
              lat: g.coordinates[1],
              name: String(p.name ?? "Zone substation"),
              postcode: p.postcode ? String(p.postcode) : undefined,
            };
          })
          .filter(Boolean) as Zone[];
        const territory: Ring[] = (tGj.features || []).flatMap((f: GeoJSON.Feature) =>
          ringsFromGeometry(f.geometry)
        );
        dataRef.current = { pcs, zones, territory };
        draw();
      } catch {
        if (cancelled) return;
        const fallback: PcFeat[] = (bundle?.postcodes || []).map((p) => {
          const [lon, lat] = p.metrics.centroid;
          const d = 0.04;
          return {
            postcode: p.postcode,
            name: p.name,
            rings: [
              [
                [lon - d, lat - d],
                [lon + d, lat - d],
                [lon + d, lat + d],
                [lon - d, lat + d],
                [lon - d, lat - d],
              ],
            ],
            score: p.scores[scoreKind],
            props: { postcode: p.postcode, name: p.name },
          };
        });
        dataRef.current = { pcs: fallback, zones: [], territory: [] };
        draw();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 8 || h < 8) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0b1118";
    ctx.fillRect(0, 0, w, h);

    const kind = useApp.getState().scoreKind;
    const sel = useApp.getState().selectedPostcode;
    const cmp = useApp.getState().comparePostcode;
    const bbox = viewBbox();

    if (showTerritory && dataRef.current.territory.length) {
      ctx.beginPath();
      for (const ring of dataRef.current.territory) {
        ring.forEach((pt, i) => {
          const [x, y] = project(pt[0], pt[1], bbox, w, h);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.strokeStyle = "rgba(74,163,154,0.85)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    if (showPostcodes) {
      for (const pc of dataRef.current.pcs) {
        const score = Number(pc.props[kind] ?? pc.score);
        ctx.beginPath();
        for (const ring of pc.rings) {
          ring.forEach((pt, i) => {
            const [x, y] = project(pt[0], pt[1], bbox, w, h);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fillStyle = scoreFill(score);
        ctx.globalAlpha = 0.82;
        ctx.fill();
        ctx.globalAlpha = 1;
        const hot = pc.postcode === sel || pc.postcode === cmp || pc.postcode === hoverRef.current;
        ctx.strokeStyle = hot ? "#e8eef4" : "rgba(141,155,170,0.35)";
        ctx.lineWidth = hot ? 2.2 : 0.6;
        ctx.stroke();
      }
    }

    if (showZones) {
      ctx.fillStyle = "#e4c37a";
      for (const z of dataRef.current.zones) {
        const [x, y] = project(z.lon, z.lat, bbox, w, h);
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

  };

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreKind, selected, compare, showZones, showPostcodes, showTerritory, focus]);

  const hit = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const bbox = viewBbox();
    for (let i = dataRef.current.pcs.length - 1; i >= 0; i--) {
      const pc = dataRef.current.pcs[i];
      for (const ring of pc.rings) {
        const projected = ring.map((pt) => project(pt[0], pt[1], bbox, w, h));
        if (pointInRing(x, y, projected)) return pc;
      }
    }
    return null;
  };

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full cursor-pointer"
        onMouseLeave={() => {
          hoverRef.current = null;
          setTip(null);
          draw();
        }}
        onMouseMove={(e) => {
          const pc = hit(e.clientX, e.clientY);
          const id = pc?.postcode ?? null;
          if (id !== hoverRef.current) {
            hoverRef.current = id;
            draw();
          }
          if (pc) {
            const kind = useApp.getState().scoreKind;
            const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
            setTip({
              x: e.clientX - r.left + 12,
              y: e.clientY - r.top + 12,
              title: `${pc.name} · ${pc.postcode}`,
              line: `Score ${Number(pc.props[kind] ?? pc.score).toFixed(0)} · click to open the panel`,
            });
          } else {
            setTip(null);
          }
        }}
        onClick={(e) => {
          const pc = hit(e.clientX, e.clientY);
          if (pc) useApp.getState().selectPostcode(pc.postcode);
        }}
      />
      {tip ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[240px] rounded border border-border bg-panel/95 px-2 py-1 text-[11px] text-ink shadow-lg"
          style={{ left: tip.x, top: tip.y }}
        >
          <p className="font-medium">{tip.title}</p>
          <p className="text-muted">{tip.line}</p>
        </div>
      ) : null}
    </div>
  );
}
