"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useApp } from "@/lib/store";

const KEY = "uiw.onboarding.v1";

const STEPS = [
  {
    title: "The map is the work surface",
    body: "Coloured areas are Endeavour postcodes. Darker teal is a lower public-data score; amber is higher. This is a relative indicator, not a constraint finding.",
    canvas:
      "This browser is using the simple map (no street basemap). Open Chrome or Edge for the full interactive MapLibre view.",
  },
  {
    title: "Click anywhere on the territory",
    body: "Try Robertson, Bowral, Moss Vale or Wollongong. The right-hand panel fills with evidence, questions and data gaps for that area.",
  },
  {
    title: "Jump with search or the chips",
    body: "Type a town or postcode, or use the place chips on the map. Compare two areas from the bottom bar.",
  },
  {
    title: "Then change workspace, not the map",
    body: "Opportunity Explorer explains the score. Account Intelligence prepares a meeting. Data Readiness is for a sample utility extract. Grid Analyst answers only from loaded data.",
  },
];

export function Onboarding({
  force,
  canvas,
  onClose,
}: {
  force?: boolean;
  canvas?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const bundleReady = Boolean(useApp((s) => s.bundle));

  useEffect(() => {
    if (force) {
      setOpen(true);
      setStep(0);
      return;
    }
    if (!bundleReady) return;
    try {
      if (!window.localStorage.getItem(KEY)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [force, bundleReady]);

  if (!open) return null;
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "done");
    } catch {
      /* ignore */
    }
    setOpen(false);
    onClose?.();
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div className="pointer-events-auto absolute bottom-14 left-1/2 w-[min(420px,calc(100%-24px))] -translate-x-1/2 rounded-lg border border-accent/40 bg-panel/95 p-4 shadow-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          Hint {step + 1} of {STEPS.length}
        </p>
        <h3 className="mt-1 text-[15px] font-medium">{current.title}</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{current.body}</p>
        {canvas && "canvas" in current && current.canvas ? (
          <p className="mt-2 text-[11px] leading-relaxed text-accent-2">{current.canvas}</p>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button className="text-[11px] text-faint underline" onClick={dismiss}>
            Skip hints
          </button>
          <div className="flex gap-1">
            {step > 0 ? (
              <Button onClick={() => setStep((s) => s - 1)}>Back</Button>
            ) : null}
            <Button
              active
              onClick={() => {
                if (last) dismiss();
                else setStep((s) => s + 1);
              }}
            >
              {last ? "Got it" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
