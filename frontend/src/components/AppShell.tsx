"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { BottomPanel } from "@/components/BottomPanel";
import { LeftSidebar } from "@/components/LeftSidebar";
import { RightPanel } from "@/components/RightPanel";
import { fetchBundle } from "@/lib/api";
import { useApp } from "@/lib/store";

const MapCanvas = dynamic(() => import("@/components/MapCanvas").then((m) => m.MapCanvas), { ssr: false });

export function AppShell() {
  const setBundle = useApp((s) => s.setBundle);
  const setError = useApp((s) => s.setError);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  const disclaimer = useApp((s) => s.bundle?.disclaimer);

  useEffect(() => {
    fetchBundle()
      .then(setBundle)
      .catch((e) => setError(e.message || "Could not load bundle. Start the API and run the data pipeline."));
  }, [setBundle, setError]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-8 items-center justify-between border-b border-border bg-bg px-3 text-[11px] text-muted">
        <span>Internal workstation · not affiliated with GridSight or Endeavour Energy</span>
        <span className="truncate pl-4 text-faint">{disclaimer}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <LeftSidebar />
        <main className="relative min-h-0 min-w-0 flex-1">
          <div className="absolute inset-0">
            {loading ? (
              <div className="flex h-full items-center justify-center text-[13px] text-muted">Loading public-data bundle…</div>
            ) : error ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-accent-2">
                {error}
                <br />
                Run <code className="font-mono">python pipelines/build_network_bundle.py</code> then{" "}
                <code className="font-mono">uvicorn backend.app.main:app --port 8000</code>
              </div>
            ) : (
              <MapCanvas />
            )}
          </div>
        </main>
        <RightPanel />
      </div>
      <BottomPanel />
    </div>
  );
}
