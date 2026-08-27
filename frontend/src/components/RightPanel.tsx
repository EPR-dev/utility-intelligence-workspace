"use client";

import { useState } from "react";
import { Banner, Button, Metric, Section } from "@/components/ui";
import { Chart } from "@/components/Chart";
import { API, postBrief, postJson, uploadReadiness } from "@/lib/api";
import { useApp } from "@/lib/store";
import { SCORE_LABELS, type Opportunity, type PostcodeRecord, type ScoreKind } from "@/lib/types";

function fmt(n: number | null | undefined, d = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export function RightPanel() {
  const workspace = useApp((s) => s.workspace);
  const bundle = useApp((s) => s.bundle);
  const pc = useApp((s) => s.selectedPostcode);
  const rec = bundle?.postcodes.find((p) => p.postcode === pc) ?? null;

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-panel/95">
      <div className="border-b border-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Intelligence</p>
        <h2 className="text-[15px] font-medium">{rec ? rec.name : bundle?.config.name ?? "Territory"}</h2>
        <p className="text-[11px] text-muted">
          {rec ? `${rec.postcode} · ${rec.region}` : "Select a postcode or asset on the map"}
        </p>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <Banner />
        {workspace === "overview" && rec && <Overview rec={rec} />}
        {workspace === "opportunity" && rec && <OpportunityView rec={rec} />}
        {workspace === "account" && <AccountView />}
        {workspace === "readiness" && <ReadinessView />}
        {workspace === "scenario" && rec && <ScenarioView rec={rec} />}
        {workspace === "analyst" && <AnalystView rec={rec} />}
        {workspace === "sources" && <SourcesView />}
        {workspace !== "account" && workspace !== "readiness" && workspace !== "sources" && workspace !== "analyst" && !rec ? (
          <p className="text-[12px] text-muted">Click a postcode to populate this panel.</p>
        ) : null}
      </div>
    </aside>
  );
}

function Overview({ rec }: { rec: PostcodeRecord }) {
  const year = useApp((s) => s.year);
  const timeline = rec.metrics.solarTimeline || {};
  const years = Object.keys(timeline).sort();
  const option = {
    backgroundColor: "transparent",
    textStyle: { color: "#8d9baa", fontSize: 10 },
    grid: { left: 28, right: 8, top: 16, bottom: 22 },
    xAxis: { type: "category" as const, data: years, axisLine: { lineStyle: { color: "#2a3644" } } },
    yAxis: { type: "value" as const, splitLine: { lineStyle: { color: "#2a3644" } } },
    series: [
      {
        type: "bar" as const,
        data: years.map((y) => ({
          value: timeline[y],
          itemStyle: { color: Number(y) === year ? "#c4a35a" : "#4aa39a" },
        })),
      },
    ],
  };
  return (
    <>
      <Section title="Network snapshot">
        <Metric label="Distribution substations" value={fmt(rec.metrics.distSubstationCount)} hint="Public point locations, not a connectivity model" />
        <Metric label="Zone substations in postcode" value={fmt(rec.metrics.zoneSubstationCount)} />
        <Metric
          label="Mean remaining load kVA"
          value={rec.metrics.meanAvailableKva == null ? "—" : fmt(rec.metrics.meanAvailableKva, 0)}
          hint="avlbl_k assigned by nearest postcode centroid. Load capacity, not export headroom."
        />
        <Metric label="CER solar systems" value={fmt(rec.metrics.solarInstallsTotal)} />
        <Metric label="CER solar kW" value={fmt(rec.metrics.solarKwTotal, 0)} />
        <Metric label="Solar growth (recent vs 2018–21)" value={`${fmt(rec.metrics.solarGrowthPct, 0)}%`} />
        <Metric label="CER batteries (from Jul 2025)" value={fmt(rec.metrics.batteryInstalls)} />
        <Metric label="Heat pumps" value={fmt(rec.metrics.heatPumpInstalls)} />
        <Metric label="OSM industrial / EV" value={`${rec.metrics.industrialCount} / ${rec.metrics.evChargerCount}`} />
        <p className="pt-2 text-[10px] text-faint">Geometry: {rec.geometrySource}</p>
      </Section>
      <Section title={`CER solar registrations · ${year} highlighted`}>
        <Chart option={option} />
      </Section>
    </>
  );
}

function OpportunityView({ rec }: { rec: PostcodeRecord }) {
  const kind = useApp((s) => s.scoreKind);
  const bundle = useApp((s) => s.bundle);
  const opp =
    bundle?.opportunities.find((o) => o.postcode === rec.postcode && o.kind === kind) ??
    bundle?.opportunities.find((o) => o.postcode === rec.postcode);
  const k: ScoreKind = opp?.kind && opp.kind !== "composite" ? opp.kind : kind === "composite" ? "flexibleExport" : kind;
  const explain = rec.scoreExplain[k];
  return (
    <>
      <OpportunityCard rec={rec} kind={k} opp={opp} />
      <Section title="Score explanation">
        <p className="text-[11px] text-muted">
          Percentile ranks within Endeavour postcodes, then the configured weights.{" "}
          {SCORE_LABELS[k]} {rec.scores[k]} / 100.
        </p>
        {explain
          ? Object.entries(explain.factors).map(([f, v]) => (
              <div key={f} className="mt-1">
                <div className="flex justify-between text-[11px] text-muted">
                  <span>{f}</span>
                  <span className="font-mono text-ink">{v == null ? "n/a" : v}</span>
                </div>
                <div className="mt-0.5 h-1 rounded bg-panel-3">
                  <div className="h-1 rounded bg-accent" style={{ width: `${v ?? 0}%` }} />
                </div>
              </div>
            ))
          : null}
        <p className="pt-2 text-[10px] text-faint">Public generation hosting is not a factor. See Evidence & Sources.</p>
      </Section>
    </>
  );
}

function OpportunityCard({ rec, kind, opp }: { rec: PostcodeRecord; kind: ScoreKind; opp?: Opportunity }) {
  return (
    <div className="rounded border border-border bg-panel-2 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent-2">Opportunity card</p>
      <h3 className="text-[16px]">{rec.name}</h3>
      <p className="text-[12px] text-muted">
        {SCORE_LABELS[kind]} · indicative score <span className="font-mono text-ink">{rec.scores[kind]} / 100</span>
      </p>
      <Section title="Why this area surfaced">
        <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">
          {(opp?.whySurfaced ?? rec.scoreCaveats).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Section>
      {opp ? (
        <>
          <Section title="Why this could matter">
            <p className="text-[12px] leading-relaxed text-muted">{opp.whyItMatters}</p>
          </Section>
          <Section title="Questions to validate with the utility">
            <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">
              {opp.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </Section>
          <Section title="Customer data required">
            <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">
              {opp.customerDataRequired.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </Section>
          <Section title="Potential solution hypotheses">
            <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">
              {opp.solutionHypotheses.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
            <p className="pt-1 text-[10px] text-faint">Not a recommendation that these are appropriate.</p>
          </Section>
        </>
      ) : null}
    </div>
  );
}

function AccountView() {
  const bundle = useApp((s) => s.bundle);
  const topic = useApp((s) => s.meetingTopic);
  const setTopic = useApp((s) => s.setMeetingTopic);
  const pc = useApp((s) => s.selectedPostcode);
  const [pack, setPack] = useState<Record<string, unknown> | null>(null);
  if (!bundle) return null;
  const snap = bundle.account.snapshot;
  return (
    <>
      <Section title="Network snapshot">
        <p className="text-[12px] leading-relaxed text-muted">{String(snap.serviceArea)}</p>
        <Metric label="Customers" value="See note" hint={String(snap.customers)} />
        <Metric label="Postcodes in bundle" value={String(snap.postcodesObserved)} />
        <Metric label="Public zone substations" value={String(snap.zoneSubstationsPublic)} />
        <Metric label="CER solar systems (sum)" value={fmt(Number(snap.solarInstallsObserved))} />
        <Metric label="CER batteries (sum)" value={fmt(Number(snap.batteryInstallsObserved))} />
      </Section>
      <Section title="Emerging network themes">
        {bundle.account.themes.map((t) => (
          <p key={t} className="text-[12px] leading-relaxed text-muted">
            {t}
          </p>
        ))}
      </Section>
      <Section title="Top opportunity areas">
        <ol className="space-y-1 text-[12px]">
          {bundle.account.topAreas.map((a, i) => (
            <li key={a.postcode}>
              <button className="text-left hover:text-accent" onClick={() => useApp.getState().selectPostcode(a.postcode)}>
                {i + 1}. {a.name} ({a.postcode}) · composite {a.scores.composite}
              </button>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Suggested conversations">
        <ul className="list-disc pl-4 text-[12px] text-muted">
          {bundle.account.suggestedConversations.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Section>
      <Section title="Discovery questions">
        {Object.entries(bundle.account.discoveryQuestions).map(([g, qs]) => (
          <div key={g} className="mb-2">
            <p className="text-[11px] capitalize text-accent">{g}</p>
            <ul className="list-disc pl-4 text-[12px] text-muted">
              {qs.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <Section title="Prepare for customer meeting">
        <div className="flex flex-wrap gap-1">
          {["flexible exports", "grid visibility", "connections", "orchestration", "general discovery"].map((t) => (
            <Button key={t} active={topic === t} onClick={() => setTopic(t)}>
              {t}
            </Button>
          ))}
        </div>
        <Button
          className="mt-2"
          onClick={async () => {
            const data = await postJson<Record<string, unknown>>("/api/meeting", {
              topic,
              postcode: pc,
              networkId: "endeavour-energy",
            });
            setPack(data);
          }}
        >
          Prepare for Customer Meeting
        </Button>
        {pack ? (
          <div className="mt-2 space-y-2 text-[12px] text-muted">
            {["whatWeKnow", "whatAppearsInteresting", "whatWeDontKnow", "questionsToAsk", "dataToRequest"].map((key) => (
              <div key={key}>
                <p className="capitalize text-accent">{key.replace(/([A-Z])/g, " $1")}</p>
                <ul className="list-disc pl-4">
                  {(pack[key] as string[]).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-accent-2">{String(pack.potentialNextStep)}</p>
          </div>
        ) : null}
      </Section>
      <Section title="Account brief">
        <div className="flex gap-1">
          <Button
            onClick={async () => {
              const md = await postBrief("markdown");
              const blob = new Blob([md], { type: "text/markdown" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "endeavour-account-brief.md";
              a.click();
            }}
          >
            Markdown
          </Button>
          <Button
            onClick={async () => {
              const html = await postBrief("html");
              const w = window.open("", "_blank");
              if (w) {
                w.document.write(html);
                w.document.close();
              }
            }}
          >
            Print-friendly HTML
          </Button>
        </div>
      </Section>
    </>
  );
}

function ReadinessView() {
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [kind, setKind] = useState("feeder");
  const [useCase, setUseCase] = useState("flexible_exports");
  return (
    <>
      <Section title="Upload a sample extract">
        <p className="text-[12px] text-muted">
          CSV, GeoJSON or GeoPackage. Demo files in <span className="font-mono">data/demo</span> are synthetic.
        </p>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-2 w-full rounded border border-border bg-bg px-2 py-1 text-[12px]">
          {["feeder", "substation", "der", "ami", "gis", "scada", "connection"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select value={useCase} onChange={(e) => setUseCase(e.target.value)} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-[12px]">
          {["flexible_exports", "network_visibility", "connections", "orchestration"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input
          type="file"
          className="mt-2 text-[11px]"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setResult(await uploadReadiness(f, kind, useCase));
          }}
        />
      </Section>
      {result ? (
        <>
          <Section title="Data health score">
            <p className="font-mono text-[22px]">{(result.readiness as { overall: number }).overall} / 100</p>
            {Object.entries(result.readiness as Record<string, number>)
              .filter(([k]) => k !== "overall")
              .map(([k, v]) => (
                <Metric key={k} label={k} value={v} />
              ))}
          </Section>
          <Section title="Issues">
            {(result.issues as { severity: string; title: string; detail: string }[]).map((i) => (
              <div key={i.title} className="mb-2 border-l-2 border-accent-2/50 pl-2">
                <p className="text-[11px] uppercase text-accent-2">{i.severity}</p>
                <p className="text-[12px]">{i.title}</p>
                <p className="text-[11px] text-muted">{i.detail}</p>
              </div>
            ))}
          </Section>
          <Section title="Implementation checklist">
            <p className="text-[12px] text-accent">{(result.checklist as { useCase: string }).useCase}</p>
            {(["available", "missing", "requiresClarification"] as const).map((k) => (
              <div key={k}>
                <p className="mt-1 text-[11px] capitalize text-muted">{k}</p>
                <ul className="list-disc pl-4 text-[12px] text-muted">
                  {((result.checklist as Record<string, string[]>)[k] || []).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="pt-2 text-[12px] text-ink">{(result.checklist as { recommendedNextStep: string }).recommendedNextStep}</p>
          </Section>
        </>
      ) : (
        <p className="text-[12px] text-muted">
          Try <span className="font-mono">synthetic_feeders.csv</span> to see a broken feeder → substation relationship.
        </p>
      )}
    </>
  );
}

function ScenarioView({ rec }: { rec: PostcodeRecord }) {
  const [homes, setHomes] = useState(500);
  const [solar, setSolar] = useState(2);
  const [batt, setBatt] = useState(5);
  const [ev, setEv] = useState(100);
  const [comm, setComm] = useState(3);
  const [out, setOut] = useState<null | { before: Record<string, number>; after: Record<string, number>; deltas: Record<string, number>; method: string }>(null);
  return (
    <>
      <Section title="Strategic scenario indicators">
        <p className="text-[12px] text-muted">
          These sliders do not run power flow. They nudge percentile-style indexes so a commercial conversation can ask “what would start to matter if…”.
        </p>
        {(
          [
            { label: "Homes", v: homes, set: setHomes, min: 0, max: 3000 },
            { label: "Rooftop solar MW", v: solar, set: setSolar, min: 0, max: 20 },
            { label: "Battery MWh", v: batt, set: setBatt, min: 0, max: 30 },
            { label: "EV chargers", v: ev, set: setEv, min: 0, max: 800 },
            { label: "Commercial MW", v: comm, set: setComm, min: 0, max: 20 },
          ] as const
        ).map(({ label, v, set, min, max }) => (
          <label key={label} className="mt-2 block text-[11px] text-muted">
            {label}: {v}
            <input
              type="range"
              min={min}
              max={max}
              value={v}
              onChange={(e) => set(Number(e.target.value))}
              className="w-full accent-[#4aa39a]"
            />
          </label>
        ))}
        <Button
          className="mt-2"
          onClick={async () => {
            const data = await postJson<{ before: Record<string, number>; after: Record<string, number>; deltas: Record<string, number>; method: string }>(
              "/api/scenario",
              { postcode: rec.postcode, homes, solarMw: solar, batteryMwh: batt, evChargers: ev, commercialMw: comm }
            );
            setOut(data);
          }}
        >
          Apply scenario
        </Button>
      </Section>
      {out ? (
        <Section title="Before vs after">
          {(["flexibleExport", "networkVisibility", "connectionAssessment", "derOrchestration"] as ScoreKind[]).map((k) => (
            <Metric
              key={k}
              label={SCORE_LABELS[k]}
              value={`${out.before[k]} → ${out.after[k]} (${out.deltas[k] >= 0 ? "+" : ""}${out.deltas[k]})`}
            />
          ))}
          <p className="pt-2 text-[10px] text-faint">{out.method}</p>
        </Section>
      ) : null}
    </>
  );
}

function AnalystView({ rec }: { rec: PostcodeRecord | null }) {
  const [q, setQ] = useState("Why did Robertson receive a high Flexible Export score?");
  const [a, setA] = useState<null | {
    observed: string[];
    hypothesis: string[];
    unknown: string[];
    citations: { dataset?: string; field: string; note: string }[];
  }>(null);
  return (
    <>
      <Section title="Grid Analyst">
        <p className="text-[12px] text-muted">
          Answers are assembled from the loaded bundle only. Observed evidence is separated from inference.
        </p>
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mt-2 h-20 w-full rounded border border-border bg-bg p-2 text-[12px]"
        />
        <Button
          className="mt-2"
          onClick={async () => {
            setA(
              await postJson("/api/analyst", {
                question: q,
                postcode: rec?.postcode,
              })
            );
          }}
        >
          Ask
        </Button>
      </Section>
      {a ? (
        <>
          <Section title="Observed evidence">
            {a.observed.map((x) => (
              <p key={x} className="text-[12px] leading-relaxed text-ink">
                {x}
              </p>
            ))}
          </Section>
          <Section title="Inference / hypothesis">
            {a.hypothesis.map((x) => (
              <p key={x} className="text-[12px] leading-relaxed text-accent-2">
                {x}
              </p>
            ))}
          </Section>
          <Section title="What we don't know">
            {a.unknown.map((x) => (
              <p key={x} className="text-[12px] text-muted">
                {x}
              </p>
            ))}
          </Section>
          <Section title="Why am I seeing this?">
            {a.citations.map((c) => (
              <p key={c.field} className="text-[11px] text-faint">
                {c.dataset} · {c.field} — {c.note}
              </p>
            ))}
          </Section>
        </>
      ) : null}
    </>
  );
}

function SourcesView() {
  const sources = useApp((s) => s.bundle?.sources) ?? [];
  return (
    <Section title="Source catalog">
      {sources.map((s) => (
        <article key={s.id} className="mb-3 rounded border border-border bg-panel-2 p-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[13px]">{s.name}</h4>
            <span className={`font-mono text-[10px] ${s.status === "connected" ? "text-ok" : "text-accent-2"}`}>
              {s.status === "connected" ? "CONNECTED" : "NOT YET CONNECTED"}
            </span>
          </div>
          <p className="text-[11px] text-muted">{s.publisher}</p>
          {s.url ? (
            <a className="text-[11px] text-accent underline" href={s.url} target="_blank" rel="noreferrer">
              {s.url}
            </a>
          ) : null}
          <p className="mt-1 text-[11px] text-muted">{s.limitations}</p>
          {s.note ? <p className="text-[11px] text-accent-2">{s.note}</p> : null}
          {s.fieldsUsed?.length ? <p className="font-mono text-[10px] text-faint">{s.fieldsUsed.join(", ")}</p> : null}
          {s.license ? <p className="text-[10px] text-faint">{s.license}</p> : null}
        </article>
      ))}
      <p className="text-[10px] text-faint">API: {API}</p>
    </Section>
  );
}

export function CompareStrip() {
  const bundle = useApp((s) => s.bundle);
  const a = useApp((s) => s.selectedPostcode);
  const b = useApp((s) => s.comparePostcode);
  const pa = bundle?.postcodes.find((p) => p.postcode === a);
  const pb = bundle?.postcodes.find((p) => p.postcode === b);
  if (!pa || !pb || a === b) return null;
  const rows: [string, number | null | undefined, number | null | undefined][] = [
    ["Flexible export", pa.scores.flexibleExport, pb.scores.flexibleExport],
    ["Visibility", pa.scores.networkVisibility, pb.scores.networkVisibility],
    ["Connections", pa.scores.connectionAssessment, pb.scores.connectionAssessment],
    ["Orchestration", pa.scores.derOrchestration, pb.scores.derOrchestration],
    ["Solar kW", pa.metrics.solarKwTotal, pb.metrics.solarKwTotal],
    ["Solar growth %", pa.metrics.solarGrowthPct, pb.metrics.solarGrowthPct],
    ["Batteries", pa.metrics.batteryInstalls, pb.metrics.batteryInstalls],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 text-[11px]">
      <div />
      <div className="font-medium">{pa.name}</div>
      <div className="font-medium">{pb.name}</div>
      {rows.map(([l, x, y]) => (
        <div key={l} className="contents">
          <div className="text-muted">{l}</div>
          <div className="font-mono">{fmt(x ?? null, 0)}</div>
          <div className="font-mono">{fmt(y ?? null, 0)}</div>
        </div>
      ))}
    </div>
  );
}
