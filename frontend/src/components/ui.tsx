"use client";

import { cn } from "@/lib/cn";

export function Button({
  children,
  onClick,
  active,
  className,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cn(
        "rounded border px-2.5 py-1 text-[11px] tracking-wide transition",
        active
          ? "border-accent/60 bg-accent/15 text-ink"
          : "border-border bg-panel-2 text-muted hover:border-accent/40 hover:text-ink",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

export function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="border-b border-border/60 py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-muted">{label}</span>
        <span className="font-mono text-[12px] text-ink">{value}</span>
      </div>
      {hint ? <p className="mt-0.5 text-[10px] text-faint">{hint}</p> : null}
    </div>
  );
}

export function Banner() {
  return (
    <p className="rounded border border-accent-2/30 bg-accent-2/8 px-2 py-1.5 text-[10px] leading-snug text-accent-2">
      Strategic indicators and hypotheses only. Not power-flow, hosting-capacity or operational conclusions.
    </p>
  );
}
