"use client";

import { useState } from "react";
import { useApp } from "@/lib/store";

export function Learn({ term }: { term: string }) {
  const [open, setOpen] = useState(false);
  const def = useApp((s) => s.bundle?.glossary?.[term]);
  return (
    <span className="relative inline">
      <button
        type="button"
        className="border-b border-dotted border-accent/70 text-left"
        onClick={() => setOpen((v) => !v)}
        title="Learn"
      >
        {term}
      </button>
      {open ? (
        <span className="absolute z-40 mt-1 w-64 rounded border border-border bg-panel-2 p-2 text-[11px] leading-snug text-muted shadow-xl">
          <span className="mb-1 block font-medium tracking-wide text-accent-2">Learn</span>
          {def ?? "Definition loads with the public-data bundle."}
        </span>
      ) : null}
    </span>
  );
}
