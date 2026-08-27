"use client";

import { Search } from "lucide-react";
import { Learn } from "@/components/Learn";
import { Button, Section } from "@/components/ui";
import { useApp } from "@/lib/store";
import { SCORE_LABELS, WORKSPACES, type ScoreKind } from "@/lib/types";

const LAYER_ITEMS: { id: string; label: string }[] = [
  { id: "territory", label: "Service territory" },
  { id: "postcodes", label: "Postcode scores" },
  { id: "zones", label: "Zone substations" },
  { id: "transmission", label: "Transmission substations" },
  { id: "hv", label: "HV switching (zoom in)" },
  { id: "industrial", label: "OSM industrial" },
  { id: "commercial", label: "OSM commercial" },
  { id: "ev", label: "OSM EV charging" },
];

export function LeftSidebar() {
  const workspace = useApp((s) => s.workspace);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const layers = useApp((s) => s.layers);
  const toggleLayer = useApp((s) => s.toggleLayer);
  const search = useApp((s) => s.search);
  const setSearch = useApp((s) => s.setSearch);
  const scoreKind = useApp((s) => s.scoreKind);
  const setScoreKind = useApp((s) => s.setScoreKind);
  const year = useApp((s) => s.year);
  const setYear = useApp((s) => s.setYear);
  const rectSelect = useApp((s) => s.rectSelect);
  const setRectSelect = useApp((s) => s.setRectSelect);
  const bundle = useApp((s) => s.bundle);

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-border bg-panel/95">
      <div className="border-b border-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">UIW</p>
        <h1 className="text-[15px] font-medium leading-tight">Utility Intelligence Workspace</h1>
        <p className="mt-1 text-[11px] leading-snug text-muted">
          {bundle?.config.name ?? "Endeavour Energy"} · public-data discovery
        </p>
      </div>

      <div className="border-b border-border px-3 py-2">
        <label className="flex items-center gap-2 rounded border border-border bg-bg px-2 py-1.5">
          <Search size={13} className="text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Town, postcode, substation"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-faint"
          />
        </label>
      </div>

      <nav className="space-y-0.5 border-b border-border p-2">
        {WORKSPACES.map((w) => (
          <button
            key={w.id}
            onClick={() => setWorkspace(w.id)}
            className={`flex w-full flex-col rounded px-2 py-1.5 text-left ${
              workspace === w.id ? "bg-panel-3 text-ink" : "text-muted hover:bg-panel-2 hover:text-ink"
            }`}
          >
            <span className="text-[12px]">{w.label}</span>
            <span className="text-[10px] text-faint">{w.hint}</span>
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <Section title="Opportunity surface">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(SCORE_LABELS) as ScoreKind[]).map((k) => (
              <Button key={k} active={scoreKind === k} onClick={() => setScoreKind(k)}>
                {SCORE_LABELS[k]}
              </Button>
            ))}
          </div>
        </Section>

        <Section title="Layers">
          <ul className="space-y-1">
            {LAYER_ITEMS.map((l) => (
              <li key={l.id}>
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
                  <input
                    type="checkbox"
                    checked={!!layers[l.id]}
                    onChange={() => toggleLayer(l.id)}
                    className="accent-[#4aa39a]"
                  />
                  {l.label}
                </label>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Time (CER registrations)">
          <input
            type="range"
            min={2019}
            max={2026}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-full accent-[#4aa39a]"
          />
          <p className="font-mono text-[11px] text-ink">{year}</p>
          <p className="text-[10px] text-faint">Latest years remain incomplete because of the 12-month STC window.</p>
        </Section>

        <Section title="Map tools">
          <div className="flex flex-wrap gap-1">
            <Button active={rectSelect} onClick={() => setRectSelect(!rectSelect)}>
              Rectangle select
            </Button>
            <Button
              onClick={() => {
                useApp.getState().setCompare(useApp.getState().selectedPostcode === "2576" ? "2500" : "2576");
              }}
            >
              Compare Bowral
            </Button>
            <Button
              onClick={() => {
                window.dispatchEvent(new Event("uiw:show-hints"));
              }}
            >
              Show hints
            </Button>
          </div>
        </Section>

        <Section title="Concepts">
          <p className="text-[11px] leading-relaxed text-muted">
            Click to <Learn term="DER" />, <Learn term="zone substation" />, <Learn term="flexible exports" /> or{" "}
            <Learn term="dynamic operating envelope" />.
          </p>
        </Section>
      </div>
    </aside>
  );
}
