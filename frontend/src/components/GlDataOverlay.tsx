"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { layerUrl } from "@/lib/api";
import { pointInRing, ringsFromGeometry, scoreFill, type Ring } from "@/lib/geo";
import { useApp } from "@/lib/store";

type PcFeat = {
  postcode: string;
  name: string;
  rings: Ring[];
  score: number;
  props: Record<string, unknown>;
};

type Zone = { lon: number; lat: number; name: string; postcode?: string };

export function GlDataOverlay({
  mapRef,
  generation,
}: {
  mapRef: MutableRefObject<MapLibreMap | null>;
  generation: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<{ pcs: PcFeat[]; zones: Zone[]; transmission: Zone[] }>({
    pcs: [],
    zones: [],
    transmission: [],
  });
  const hoverRef = useRef<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; line: string } | null>(null);

  const scoreKind = useApp((s) => s.scoreKind);
  const selected = useApp((s) => s.selectedPostcode);
  const compare = useApp((s) => s.comparePostcode);
  const showZones = useApp((s) => s.layers.zones);
  const showPostcodes = useApp((s) => s.layers.postcodes);
  const showTransmission = useApp((s) => s.layers.transmission);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pcRes, zRes, tRes] = await Promise.all([
          fetch(layerUrl("postcodes")),
          fetch(layerUrl("zone_substations")),
          fetch(layerUrl("transmission_substations")),
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
        const asZones = (gj: { features?: GeoJSON.Feature[] }): Zone[] =>
          (gj.features || [])
            .map((f) => {
              const g = f.geometry;
              if (!g || g.type !== "Point") return null;
              const p = (f.properties || {}) as Record<string, unknown>;
              return {
                lon: g.coordinates[0],
                lat: g.coordinates[1],
                name: String(p.name ?? "Substation"),
                postcode: p.postcode ? String(p.postcode) : undefined,
              };
            })
            .filter(Boolean) as Zone[];
        dataRef.current = { pcs, zones: asZones(zGj), transmission: asZones(tGj) };
        draw();
      } catch {
        /* overlay stays empty until retry */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  const draw = () => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas || !map) return;
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

    const kind = useApp.getState().scoreKind;
    const sel = useApp.getState().selectedPostcode;
    const cmp = useApp.getState().comparePostcode;
    const hover = hoverRef.current;
    const toScreen = (lon: number, lat: number): [number, number] => {
      const p = map.project([lon, lat]);
      return [p.x, p.y];
    };

    if (showPostcodes) {
      for (const pc of dataRef.current.pcs) {
        const score = Number(pc.props[kind] ?? pc.score);
        ctx.beginPath();
        for (const ring of pc.rings) {
          ring.forEach((pt, i) => {
            const [x, y] = toScreen(pt[0], pt[1]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fillStyle = scoreFill(score);
        ctx.globalAlpha = 0.72;
        ctx.fill();
        ctx.globalAlpha = 1;
        const hot = pc.postcode === sel || pc.postcode === cmp || pc.postcode === hover;
        ctx.strokeStyle = hot ? "#f4f7fa" : "rgba(232,238,244,0.55)";
        ctx.lineWidth = hot ? 2.4 : 0.9;
        ctx.stroke();
      }
    }

    const drawPts = (pts: Zone[], color: string, r: number) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = "#080b0f";
      ctx.lineWidth = 1.2;
      for (const z of pts) {
        const [x, y] = toScreen(z.lon, z.lat);
        if (x < -8 || y < -8 || x > w + 8 || y > h + 8) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };
    if (showZones) drawPts(dataRef.current.zones, "#e4c37a", 5.2);
    if (showTransmission) drawPts(dataRef.current.transmission, "#d97b6c", 6);
  };

  useEffect(() => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    if (!map || !canvas) return;

    const redraw = () => draw();
    map.on("move", redraw);
    map.on("zoom", redraw);
    map.on("resize", redraw);
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    redraw();

    const hitLngLat = (lng: number, lat: number) => {
      const pcs = dataRef.current.pcs;
      for (let i = pcs.length - 1; i >= 0; i--) {
        for (const ring of pcs[i].rings) {
          if (pointInRing(lng, lat, ring)) return pcs[i];
        }
      }
      return null;
    };

    const onMove = (e: { lngLat: { lng: number; lat: number }; point: { x: number; y: number } }) => {
      const pc = hitLngLat(e.lngLat.lng, e.lngLat.lat);
      const id = pc?.postcode ?? null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        draw();
      }
      if (pc) {
        const kind = useApp.getState().scoreKind;
        map.getCanvas().style.cursor = "pointer";
        setTip({
          x: e.point.x + 12,
          y: e.point.y + 12,
          title: `${pc.name} · ${pc.postcode}`,
          line: `Score ${Number(pc.props[kind] ?? pc.score).toFixed(0)} · click to open the panel`,
        });
      } else {
        map.getCanvas().style.cursor = "";
        setTip(null);
      }
    };
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
      const pc = hitLngLat(e.lngLat.lng, e.lngLat.lat);
      if (pc) useApp.getState().selectPostcode(pc.postcode);
    };

    map.on("mousemove", onMove);
    map.on("mouseleave", () => {
      hoverRef.current = null;
      setTip(null);
      map.getCanvas().style.cursor = "";
      draw();
    });
    map.on("click", onClick);

    return () => {
      map.off("move", redraw);
      map.off("zoom", redraw);
      map.off("resize", redraw);
      map.off("mousemove", onMove);
      map.off("click", onClick);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, scoreKind, selected, compare, showZones, showPostcodes, showTransmission]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      {tip ? (
        <div
          className="absolute z-20 max-w-[240px] rounded border border-border bg-panel/95 px-2 py-1 text-[11px] text-ink shadow-lg"
          style={{ left: tip.x, top: tip.y }}
        >
          <p className="font-medium">{tip.title}</p>
          <p className="text-muted">{tip.line}</p>
        </div>
      ) : null}
    </div>
  );
}
