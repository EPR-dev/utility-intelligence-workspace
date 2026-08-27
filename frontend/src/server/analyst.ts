import type { JsonMap } from "@/server/bundle";

type Citation = {
  sourceId: string;
  dataset?: string;
  publisher?: string;
  field: string;
  note: string;
  status?: string;
};

function asNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function analyse(question: string, bundle: JsonMap, postcode?: string | null) {
  const q = question.trim();
  const qL = q.toLowerCase();
  const citations: Citation[] = [];
  const observed: string[] = [];
  const hypothesis: string[] = [];
  const unknown: string[] = [];
  const sources = (bundle.sources as JsonMap[]) || [];
  const postcodes = (bundle.postcodes as JsonMap[]) || [];

  const cite = (sourceId: string, field: string, note: string) => {
    const src = sources.find((s) => s.id === sourceId);
    citations.push({
      sourceId,
      dataset: src?.name as string | undefined,
      publisher: src?.publisher as string | undefined,
      field,
      note,
      status: src?.status as string | undefined,
    });
  };

  let target: JsonMap | null = null;
  if (postcode) target = postcodes.find((p) => p.postcode === postcode) ?? null;
  if (!target) {
    const m = q.match(/\b(\d{4})\b/);
    if (m) target = postcodes.find((p) => p.postcode === m[1]) ?? null;
  }
  for (const place of ["robertson", "bowral", "moss vale", "wollongong", "mittagong", "kiama", "nowra"]) {
    if (qL.includes(place)) {
      target =
        postcodes.find((p) => {
          const name = String(p.name ?? "").toLowerCase();
          const locs = ((p.localities as string[]) || []).join(" ").toLowerCase();
          return name.includes(place) || locs.includes(place);
        }) ?? target;
    }
  }

  if (["fastest", "growing", "growth", "der area"].some((w) => qL.includes(w))) {
    const ranked = [...postcodes]
      .sort((a, b) => asNum((b.metrics as JsonMap)?.solarGrowthPct) - asNum((a.metrics as JsonMap)?.solarGrowthPct))
      .slice(0, 5);
    for (const p of ranked) {
      const m = p.metrics as JsonMap;
      observed.push(
        `${p.name} (${p.postcode}): CER solar installations changed about ${asNum(m.solarGrowthPct).toFixed(0)}% ` +
          `when comparing 2022–current with 2018–2021 (${Math.trunc(asNum(m.solarInstallsRecent))} recent systems in the public file).`
      );
    }
    cite("cer-sres", "year columns 2018–current", "Growth is STC registration counts, not connected-inverter counts.");
    hypothesis.push(
      "If those postcodes also have limited export capacity, this growth would increase the value of flexible exports. That capacity condition is not in the public bundle."
    );
    unknown.push("Feeder-level export limits, voltage traces and the utility DER register.");
  } else if (["investigate", "opportunit", "where should", "deserve"].some((w) => qL.includes(w))) {
    const ranked = [...postcodes]
      .sort((a, b) => asNum((b.scores as JsonMap)?.composite) - asNum((a.scores as JsonMap)?.composite))
      .slice(0, 6);
    for (const p of ranked) {
      const s = p.scores as JsonMap;
      observed.push(
        `${p.name} (${p.postcode}) composite indicator ${s.composite} ` +
          `(flexible export ${s.flexibleExport}, visibility ${s.networkVisibility}, ` +
          `connections ${s.connectionAssessment}, orchestration ${s.derOrchestration}).`
      );
    }
    cite("ee-opendata", "zone substations + available kVA", "Scores are percentile ranks inside this network, not engineering grades.");
    cite("cer-sres", "installations and capacity", "DER intensity inputs.");
    hypothesis.push(
      "These locations are the most distinctive in the public pattern, so they are the best places to start a customer conversation."
    );
    unknown.push("Whether any of these areas are actually constrained, queued, or already covered by a utility programme.");
  } else if (qL.includes("question") || qL.includes("planning manager") || qL.includes("ask")) {
    observed.push(
      "The public bundle contains zone substations, distribution-substation locations, remaining load-capacity points, and CER postcode DER statistics."
    );
    cite("ee-opendata", "asset inventory", "What we can see without an NDA.");
    hypothesis.push(
      "A network planning manager will care about model confidence, DER forecast error, and where connection studies are slow — not about a public choropleth."
    );
    unknown.push(
      "Which zone substations they consider poorly observed.",
      "Whether AMI is usable for planning in the Southern Highlands and Illawarra.",
      "What they already use for hosting-capacity or flexible-export trials."
    );
    const account = bundle.account as JsonMap;
    const discovery = account.discoveryQuestions as Record<string, string[]>;
    return {
      question: q,
      observed,
      hypothesis,
      unknown,
      questionsToAsk: discovery.networkPlanning,
      citations,
      disclaimer: bundle.disclaimer,
      subject: target,
    };
  } else if (qL.includes("battery") || qL.includes("orchestr")) {
    const ranked = [...postcodes]
      .sort((a, b) => asNum((b.metrics as JsonMap)?.batteryInstalls) - asNum((a.metrics as JsonMap)?.batteryInstalls))
      .slice(0, 5);
    if (!ranked.some((p) => (p.metrics as JsonMap)?.batteryInstalls)) {
      observed.push(
        "CER battery postcode statistics are present only from July 2025. If totals are zero, the extract may not have included this network's postcodes yet, or uptake is still thin."
      );
    }
    for (const p of ranked) {
      const m = p.metrics as JsonMap;
      if (m.batteryInstalls) {
        observed.push(
          `${p.name} (${p.postcode}): ${Math.trunc(asNum(m.batteryInstalls))} STC-registered batteries; orchestration indicator ${(p.scores as JsonMap).derOrchestration}.`
        );
      }
    }
    cite("cer-sres", "SGU-Battery installations", "Scheme start 1 July 2025; pending STCs are excluded.");
    hypothesis.push(
      "Battery orchestration becomes commercially interesting where solar is already dense and the utility can signal devices. Public data can only flag the first of those conditions."
    );
    unknown.push("CSIP-Aus device counts, tariff arrangements, and constraint hours.");
  } else if (qL.includes("data") && ["need", "additional", "require", "missing"].some((w) => qL.includes(w))) {
    observed.push(
      "Connected public sources: Endeavour open network assets and capacity, CER small-scale postcode files, optional OSM context, optional ABS POA geometry."
    );
    for (const s of sources) {
      if (s.status === "not_connected") unknown.push(`${s.name}: ${(s.note as string) || "not connected"}`);
    }
    cite("ee-hosting", "generation hosting", "Not connected.");
    hypothesis.push(
      "A first NDA data pack of one depot — feeders, LV connectivity, AMI, DER register — would tell us whether any high-scoring postcode is a real product opportunity."
    );
  } else if (target && (qL.includes("why") || qL.includes("score") || qL.includes("flexible") || target)) {
    const p = target;
    const exp = ((p.scoreExplain as JsonMap)?.flexibleExport as JsonMap) || {};
    const scores = p.scores as JsonMap;
    const metrics = p.metrics as JsonMap;
    observed.push(
      `${p.name} (${p.postcode}) flexible-export indicator is ${scores.flexibleExport} / 100 (percentile mix inside Endeavour postcodes).`
    );
    const factors = (exp.factors as Record<string, number | null>) || {};
    observed.push("Factor ranks: " + Object.entries(factors).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(", "));
    observed.push(
      `CER solar systems (total in file) ${Math.trunc(asNum(metrics.solarInstallsTotal))}; recent-period systems ${Math.trunc(asNum(metrics.solarInstallsRecent))}; ` +
        `growth ${asNum(metrics.solarGrowthPct).toFixed(0)}%; batteries ${Math.trunc(asNum(metrics.batteryInstalls))}.`
    );
    if (metrics.meanAvailableKva != null) {
      observed.push(
        `Mean remaining distribution-substation load capacity assigned to this postcode is about ${asNum(metrics.meanAvailableKva).toFixed(0)} kVA. That is not export headroom.`
      );
    }
    cite("cer-sres", "SGU-Solar installations / capacity", "Postcode-level STC statistics.");
    cite("ee-opendata", "avlbl_k", "Load-capacity indicator only.");
    hypothesis.push(
      `If export capacity is limited around ${p.name}, this DER pattern would support a flexible-export and visibility discussion. The public bundle cannot confirm that 'if'.`
    );
    unknown.push("Actual export limits, voltage performance, and DOE/CSIP-Aus status for this area.");
  } else {
    const cfg = bundle.config as JsonMap;
    const stats = bundle.stats as JsonMap;
    observed.push(`Loaded network: ${cfg.name}. ${stats.postcodes} postcodes, ${stats.zoneSubstations} public zone substations.`);
    observed.push("Ask about fastest-growing DER areas, why a town scored highly, questions for a planning manager, or missing data.");
    hypothesis.push("The workstation is for discovery, not for answering unasked engineering questions.");
    unknown.push("Anything below the public zone-substation layer.");
  }

  return {
    question: q,
    observed,
    hypothesis,
    unknown,
    citations,
    disclaimer: bundle.disclaimer,
    subject: target ? { postcode: target.postcode, name: target.name } : null,
  };
}
