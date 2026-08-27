"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, Popup } from "maplibre-gl";
import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { GlDataOverlay } from "@/components/GlDataOverlay";
import { Onboarding } from "@/components/Onboarding";
import { SimpleMap } from "@/components/SimpleMap";
import { Button } from "@/components/ui";
import { resolveBrowserBasemap } from "@/lib/basemap";
import { hasWebGL2 } from "@/lib/geo";
import { useApp } from "@/lib/store";
import type { ScoreKind } from "@/lib/types";

function scoreColor(kind: ScoreKind): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["to-number", ["coalesce", ["get", kind], 0]],
    0,
    "#1a4a52",
    20,
    "#1f6a66",
    40,
    "#2e8a7e",
    60,
    "#4aa39a",
    80,
    "#c4a35a",
    100,
    "#e4c37a",
  ];
}

export function MapCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [engine, setEngine] = useState<"gl" | "canvas">(() => (hasWebGL2() ? "gl" : "canvas"));
  const [status, setStatus] = useState("Preparing map…");
  const [hints, setHints] = useState(false);
  const [focus, setFocus] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [mapGen, setMapGen] = useState(0);

  const layers = useApp((s) => s.layers);
  const scoreKind = useApp((s) => s.scoreKind);
  const selected = useApp((s) => s.selectedPostcode);
  const compare = useApp((s) => s.comparePostcode);
  const rectSelect = useApp((s) => s.rectSelect);
  const bundle = useApp((s) => s.bundle);
  const places = bundle?.config.focusPlaces ?? [];

  useEffect(() => {
    if (engine !== "gl" || !container.current) return;
    let cancelled = false;
    const el = container.current;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: el,
        style: resolveBrowserBasemap(),
        center: (bundle?.config.map.defaultCenter as [number, number]) ?? [150.62, -34.48],
        zoom: bundle?.config.map.defaultZoom ?? 8.4,
        attributionControl: true,
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      setEngine("canvas");
      setStatus("Using the drawing fallback — WebGL is unavailable in this browser.");
      return;
    }

    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    popupRef.current = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    const resize = () => {
      try {
        map.resize();
      } catch {
        /* ignore */
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    requestAnimationFrame(resize);

    map.on("error", (e) => {
      const msg = String((e as { error?: Error }).error?.message ?? "");
      if (/webgl|gpu/i.test(msg)) {
        setEngine("canvas");
        setStatus("Using the drawing fallback — WebGL is unavailable in this browser.");
      }
    });

    const ready = () => {
      if (cancelled) return;
      const n = bundle?.stats.postcodes ?? "—";
      const z = bundle?.stats.zoneSubstations ?? "—";
      setStatus(`${n} postcodes · ${z} public zone substations · click an area`);
      setMapGen((g) => g + 1);
      resize();
    };
    if (map.loaded()) ready();
    else map.once("load", ready);

    return () => {
      cancelled = true;
      ro.disconnect();
      try {
        map.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("pc-fill")) return;
    map.setPaintProperty("pc-fill", "fill-color", scoreColor(scoreKind));
  }, [scoreKind]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("pc-selected")) return;
    const filters: unknown[] = [];
    if (selected) filters.push(["==", ["get", "postcode"], selected]);
    if (compare) filters.push(["==", ["get", "postcode"], compare]);
    map.setFilter(
      "pc-selected",
      filters.length === 0
        ? ["==", ["get", "postcode"], ""]
        : filters.length === 1
          ? (filters[0] as FilterSpecification)
          : (["any", ...filters] as FilterSpecification)
    );
  }, [selected, compare]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const vis = (layer: string, on: boolean) => {
      if (!map.getLayer(layer)) return;
      map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
    };
    vis("territory-fill", layers.territory);
    vis("territory-line", layers.territory);
    vis("pc-fill", layers.postcodes);
    vis("pc-line", layers.postcodes);
    vis("pc-selected", layers.postcodes);
    vis("zones-pt", layers.zones);
    vis("transmission-pt", layers.transmission);
    vis("hv-pt", layers.hv);
    vis("industrial-pt", layers.industrial);
    vis("commercial-pt", layers.commercial);
    vis("ev-pt", layers.ev);
  }, [layers]);

  useEffect(() => {
    const show = () => setHints(true);
    window.addEventListener("uiw:show-hints", show);
    return () => window.removeEventListener("uiw:show-hints", show);
  }, []);

  useEffect(() => {
    if (engine !== "canvas") return;
    const n = bundle?.stats.postcodes ?? "—";
    const z = bundle?.stats.zoneSubstations ?? "—";
    setStatus(`${n} postcodes · ${z} public zone substations · click an area`);
  }, [engine, bundle]);

  useEffect(() => {
    const unsub = useApp.subscribe((s, prev) => {
      if (s.search === prev.search) return;
      const q = s.search.trim().toLowerCase();
      if (q.length < 2 || !s.bundle) return;
      const place = s.bundle.config.focusPlaces.find((p) => p.name.toLowerCase().includes(q));
      const pc = s.bundle.postcodes.find(
        (p) => p.postcode === q || p.name.toLowerCase().includes(q) || p.localities.some((l) => l.toLowerCase().includes(q))
      );
      const target = place?.center ?? pc?.metrics.centroid;
      const zoom = place?.zoom ?? 11.4;
      const postcode = place?.postcodes[0] ?? pc?.postcode;
      if (postcode) s.selectPostcode(postcode);
      if (!target) return;
      if (mapRef.current) {
        mapRef.current.flyTo({ center: target as [number, number], zoom, essential: true });
      } else {
        setFocus({ center: target as [number, number], zoom });
      }
    });
    return unsub;
  }, []);

  const flyPlace = (center: [number, number], zoom: number, postcodes: string[]) => {
    if (postcodes[0]) useApp.getState().selectPostcode(postcodes[0]);
    if (mapRef.current) mapRef.current.flyTo({ center, zoom, essential: true });
    else setFocus({ center, zoom });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!rectSelect || !container.current || engine !== "gl") return;
    const r = container.current.getBoundingClientRect();
    drag.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (boxRef.current) {
      boxRef.current.style.display = "block";
      boxRef.current.style.left = `${drag.current.x}px`;
      boxRef.current.style.top = `${drag.current.y}px`;
      boxRef.current.style.width = "0px";
      boxRef.current.style.height = "0px";
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!rectSelect || !drag.current || !container.current || !boxRef.current) return;
    const r = container.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    boxRef.current.style.left = `${Math.min(x, drag.current.x)}px`;
    boxRef.current.style.top = `${Math.min(y, drag.current.y)}px`;
    boxRef.current.style.width = `${Math.abs(x - drag.current.x)}px`;
    boxRef.current.style.height = `${Math.abs(y - drag.current.y)}px`;
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const map = mapRef.current;
    const start = drag.current;
    drag.current = null;
    if (boxRef.current) boxRef.current.style.display = "none";
    if (!rectSelect || !map || !start || !container.current || !bundle) return;
    const r = container.current.getBoundingClientRect();
    const a = map.unproject([start.x, start.y]);
    const b = map.unproject([e.clientX - r.left, e.clientY - r.top]);
    const minx = Math.min(a.lng, b.lng);
    const maxx = Math.max(a.lng, b.lng);
    const miny = Math.min(a.lat, b.lat);
    const maxy = Math.max(a.lat, b.lat);
    const ids = bundle.postcodes
      .filter((p) => {
        const [lon, lat] = p.metrics.centroid;
        return lon >= minx && lon <= maxx && lat >= miny && lat <= maxy;
      })
      .map((p) => p.postcode);
    useApp.getState().setSelectedSet(ids);
    useApp.getState().setBottomOpen(true);
    if (ids[0]) useApp.getState().selectPostcode(ids[0]);
  };

  return (
    <div className="relative h-full w-full" onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      {engine === "gl" ? (
        <>
          <div ref={container} className="absolute inset-0" />
          {mapGen > 0 ? <GlDataOverlay mapRef={mapRef} generation={mapGen} /> : null}
        </>
      ) : (
        <SimpleMap focus={focus} />
      )}
      <div ref={boxRef} className="pointer-events-none absolute hidden border border-accent bg-accent/10" />

      <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[min(520px,calc(100%-24px))] flex-wrap gap-1">
        {places.map((p) => (
          <button
            key={p.id}
            className="pointer-events-auto rounded border border-border bg-panel/90 px-2 py-1 text-[11px] text-ink hover:border-accent/60"
            onClick={() => flyPlace(p.center as [number, number], p.zoom, p.postcodes)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute right-3 top-3 z-20 w-40 rounded border border-border bg-panel/90 p-2 text-[10px] text-muted">
        <p className="mb-1 font-mono uppercase tracking-[0.14em] text-faint">Score</p>
        <div className="h-2 rounded bg-gradient-to-r from-[#1c2733] via-[#4aa39a] to-[#e4c37a]" />
        <div className="mt-1 flex justify-between">
          <span>Lower</span>
          <span>Higher</span>
        </div>
        <p className="mt-1 leading-snug">Relative to other Endeavour postcodes. Not a constraint.</p>
      </div>

      <div className="absolute bottom-8 left-3 z-20 flex max-w-[min(560px,calc(100%-24px))] items-center gap-2">
        <p className="rounded border border-border bg-panel/90 px-2 py-1 text-[10px] text-muted">
          {engine === "gl" ? "MapLibre" : "Canvas map"} · {status}
        </p>
        {engine === "gl" ? (
          <Button className="!text-[10px]" onClick={() => setEngine("canvas")}>
            Use simple map
          </Button>
        ) : hasWebGL2() ? (
          <Button className="!text-[10px]" onClick={() => setEngine("gl")}>
            Try interactive map
          </Button>
        ) : (
          <span className="text-[10px] text-faint">Open in Chrome/Edge for the full WebGL map.</span>
        )}
        <Button className="!text-[10px]" onClick={() => setHints(true)}>
          Show hints
        </Button>
      </div>

      <Onboarding force={hints} canvas={engine === "canvas"} onClose={() => setHints(false)} />
    </div>
  );
}
