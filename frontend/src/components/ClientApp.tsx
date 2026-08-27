"use client";

import dynamic from "next/dynamic";

const AppShell = dynamic(() => import("@/components/AppShell").then((m) => m.AppShell), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-muted">Loading workspace…</div>
  ),
});

export function ClientApp() {
  return <AppShell />;
}
