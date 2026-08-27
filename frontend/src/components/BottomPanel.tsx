"use client";

import { Button } from "@/components/ui";
import { CompareStrip } from "@/components/RightPanel";
import { useApp } from "@/lib/store";
import { SCORE_LABELS } from "@/lib/types";

export function BottomPanel() {
  const open = useApp((s) => s.bottomOpen);
  const setOpen = useApp((s) => s.setBottomOpen);
  const selectedSet = useApp((s) => s.selectedSet);
  const bundle = useApp((s) => s.bundle);
  const year = useApp((s) => s.year);
  const compare = useApp((s) => s.comparePostcode);
  const setCompare = useApp((s) => s.setCompare);

  const rows = (selectedSet.length ? bundle?.postcodes.filter((p) => selectedSet.includes(p.postcode)) : bundle?.postcodes.slice(0, 12)) ?? [];

  return (
    <div className={`border-t border-border bg-panel ${open ? "h-[220px]" : "h-9"} shrink-0 transition-[height]`}>
      <div className="flex h-9 items-center justify-between px-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Inspection · CER year {year}</p>
        <div className="flex gap-1">
          {compare ? (
            <Button onClick={() => setCompare(null)}>Clear compare</Button>
          ) : (
            <Button onClick={() => setCompare("2576")}>Compare vs Bowral 2576</Button>
          )}
          <Button onClick={() => setOpen(!open)}>{open ? "Hide" : "Show table"}</Button>
        </div>
      </div>
      {open ? (
        <div className="grid h-[180px] grid-cols-2 gap-3 overflow-hidden px-3 pb-3">
          <div className="overflow-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-faint">
                <tr>
                  <th className="py-1">Area</th>
                  <th>PC</th>
                  <th>{SCORE_LABELS.flexibleExport}</th>
                  <th>Solar kW</th>
                  <th>Growth</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.postcode}
                    className="cursor-pointer border-t border-border/70 hover:bg-panel-2"
                    onClick={() => useApp.getState().selectPostcode(p.postcode)}
                  >
                    <td className="py-1">{p.name}</td>
                    <td className="font-mono">{p.postcode}</td>
                    <td className="font-mono">{p.scores.flexibleExport}</td>
                    <td className="font-mono">{Math.round(p.metrics.solarKwTotal).toLocaleString()}</td>
                    <td className="font-mono">{Math.round(p.metrics.solarGrowthPct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-auto rounded border border-border p-2">
            <p className="mb-2 text-[10px] uppercase tracking-widest text-faint">Compare</p>
            <CompareStrip />
          </div>
        </div>
      ) : null}
    </div>
  );
}
