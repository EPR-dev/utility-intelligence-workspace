import type { JsonMap } from "@/server/bundle";

const DISCLAIMER =
  "This analysis uses public data and provides exploratory strategic hypotheses only. " +
  "Network engineering conclusions require utility-owned operational data and engineering validation.";

function clip(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
}

export function renderMarkdown(bundle: JsonMap, topic?: string | null): string {
  const acc = bundle.account as JsonMap;
  const cfg = bundle.config as JsonMap;
  const snapshot = acc.snapshot as JsonMap;
  const lines: string[] = [
    `# Account brief — ${cfg.name}`,
    "",
    `_Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC_`,
    "",
    `> ${DISCLAIMER}`,
    "",
    `**Affiliation:** ${bundle.notAffiliated ?? ""}`,
    "",
    "## Territory overview",
    "",
    String(cfg.description ?? ""),
    "",
    `- Approximate customers: ${snapshot.customers}`,
    `- Public zone substations in bundle: ${snapshot.zoneSubstationsPublic}`,
    `- Postcodes with network assets: ${snapshot.postcodesObserved}`,
    `- CER solar systems (sum of postcodes in bundle): ${Number(snapshot.solarInstallsObserved).toLocaleString()}`,
    `- CER batteries (from July 2025, sum): ${Number(snapshot.batteryInstallsObserved).toLocaleString()}`,
    "",
    "## Key spatial trends",
    "",
  ];
  for (const t of (acc.themes as string[]) || []) lines.push(`- ${t}`);
  lines.push("", "## Top opportunity areas", "");
  lines.push("| Area | Postcode | Flexible export | Visibility | Connections | Orchestration |");
  lines.push("|---|---|---:|---:|---:|---:|");
  for (const a of (acc.topAreas as JsonMap[]) || []) {
    const s = a.scores as JsonMap;
    lines.push(`| ${a.name} | ${a.postcode} | ${s.flexibleExport} | ${s.networkVisibility} | ${s.connectionAssessment} | ${s.derOrchestration} |`);
  }
  lines.push("", "## Evidence used", "");
  for (const s of (bundle.sources as JsonMap[]) || []) {
    const status = s.status === "connected" ? "connected" : "NOT YET CONNECTED";
    lines.push(`- **${s.name}** (${s.publisher ?? ""}) — ${status}`);
    if (s.url) lines.push(`  - ${s.url}`);
    if (s.limitations) lines.push(`  - Limitation: ${s.limitations}`);
    if (s.note) lines.push(`  - ${s.note}`);
  }
  lines.push("", "## Likely customer questions", "");
  const discovery = (acc.discoveryQuestions as Record<string, string[]>) || {};
  for (const [group, qs] of Object.entries(discovery)) {
    lines.push(`### ${group.charAt(0).toUpperCase()}${group.slice(1)}`);
    for (const q of qs) lines.push(`- ${q}`);
    lines.push("");
  }
  lines.push("## Data gaps", "");
  for (const g of (acc.dataGaps as JsonMap[]) || []) {
    lines.push(`- ${g.name}: ${g.note || "Not connected"}`);
  }
  lines.push(
    "",
    "## Potential next steps",
    "",
    "1. Pick one depot (Southern Highlands or Illawarra) for a scoped discovery workshop.",
    "2. Request a sample data pack: feeders, LV connectivity, DER register, AMI extract.",
    "3. Run that pack through Data Readiness before any product demonstration.",
    "4. Treat high public scores as conversation starters, not as a ranked sales list.",
    ""
  );
  if (topic) lines.push(`## Meeting topic: ${topic}`, "");
  return lines.join("\n") + "\n";
}

export function printHtml(md: string): string {
  const escaped = md.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const body: string[] = [];
  for (const line of escaped.split("\n")) {
    if (line.startsWith("# ")) body.push(`<h1>${line.slice(2)}</h1>`);
    else if (line.startsWith("## ")) body.push(`<h2>${line.slice(3)}</h2>`);
    else if (line.startsWith("### ")) body.push(`<h3>${line.slice(4)}</h3>`);
    else if (line.startsWith("> ")) body.push(`<blockquote>${line.slice(2)}</blockquote>`);
    else if (line.startsWith("- ")) body.push(`<li>${line.slice(2)}</li>`);
    else if (line.startsWith("|")) body.push(`<pre>${line}</pre>`);
    else if (line.trim() === "") body.push("<br/>");
    else body.push(`<p>${line}</p>`);
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Account brief</title>
<style>
  body { font-family: Georgia, serif; max-width: 820px; margin: 40px auto; color: #111; }
  h1,h2,h3 { font-family: 'Segoe UI', sans-serif; }
  blockquote { background: #f4f1ea; padding: 12px 16px; border-left: 4px solid #444; }
  li { margin-left: 1.2em; }
  @media print { body { margin: 16px; } }
</style></head><body>${body.join("")}</body></html>`;
}

export function meetingPack(bundle: JsonMap, topic: string, postcode?: string | null) {
  const acc = bundle.account as JsonMap;
  const cfg = bundle.config as JsonMap;
  const stats = bundle.stats as JsonMap;
  const postcodes = (bundle.postcodes as JsonMap[]) || [];
  const subject = postcode ? postcodes.find((p) => p.postcode === postcode) ?? null : null;
  const known = [
    `${cfg.name} public zone substations: ${stats.zoneSubstations}.`,
    "CER small-scale postcode statistics are connected for solar (and batteries from July 2025 where present).",
    "Distribution-substation remaining load capacity is published as avlbl_k and is not generation hosting capacity.",
  ];
  let interesting = ((acc.themes as string[]) || []).slice(0, 3);
  if (subject) {
    const scores = subject.scores as JsonMap;
    const metrics = subject.metrics as JsonMap;
    interesting = [
      `${subject.name} flexible-export indicator ${scores.flexibleExport}, solar growth ${Number(metrics.solarGrowthPct).toFixed(0)}%.`,
      ...interesting,
    ];
  }
  const dont = ((bundle.sources as JsonMap[]) || [])
    .filter((s) => s.status !== "connected")
    .map((s) => (s.note as string) || String(s.name));
  const dq = acc.discoveryQuestions as Record<string, string[]>;
  const topicQ: Record<string, string[]> = {
    "flexible exports": [...(dq.networkPlanning || []), ...(dq.operations || []).slice(0, 2)],
    "grid visibility": [...(dq.data || []), ...(dq.networkPlanning || []).slice(0, 2)],
    connections: [...(dq.commercial || []).slice(0, 2), "Where do connection studies currently stall?", "Which supply points have the longest queue?"],
    orchestration: [...(dq.operations || []), ...(dq.implementation || []).slice(0, 2)],
    "general discovery": Object.values(dq).flatMap((qs) => qs.slice(0, 1)),
  };
  const key = topic.toLowerCase().trim();
  return {
    topic,
    subject: subject ? { name: subject.name, postcode: subject.postcode } : null,
    whatWeKnow: known,
    whatAppearsInteresting: interesting,
    whatWeDontKnow: dont,
    questionsToAsk: topicQ[key] || topicQ["general discovery"],
    dataToRequest: [
      "One depot GIS extract with feeder and LV connectivity",
      "DER register for that depot",
      "Interval meter sample (daytime reverse-flow days)",
      "Connection queue snapshot",
      "Any existing hosting-capacity or flexible-export trial notes",
    ],
    potentialNextStep:
      "Agree a two-week data-readiness exercise on a single depot rather than a network-wide platform discussion.",
    disclaimer: DISCLAIMER,
  };
}

export function scenarioShift(bundle: JsonMap, postcode: string, shocks: Record<string, number>) {
  const pc = ((bundle.postcodes as JsonMap[]) || []).find((p) => p.postcode === postcode);
  if (!pc) throw new Error("Unknown postcode");
  const before = { ...(pc.scores as Record<string, number>) };
  const homes = shocks.homes || 0;
  const solarMw = shocks.solarMw || 0;
  const batteryMwh = shocks.batteryMwh || 0;
  const evs = shocks.evChargers || 0;
  const commercialMw = shocks.commercialMw || 0;
  const after = { ...before };
  after.flexibleExport = clip(before.flexibleExport + 4.5 * solarMw + 1.2 * batteryMwh + 0.01 * homes);
  after.networkVisibility = clip(before.networkVisibility + 0.02 * homes + 2.0 * solarMw + 1.5 * commercialMw);
  after.connectionAssessment = clip(before.connectionAssessment + 6.0 * commercialMw + 0.015 * homes + 0.02 * evs);
  after.derOrchestration = clip(before.derOrchestration + 3.5 * batteryMwh + 0.04 * evs + 2.0 * solarMw);
  after.composite = Math.round(((after.flexibleExport + after.networkVisibility + after.connectionAssessment + after.derOrchestration) / 4) * 10) / 10;
  return {
    postcode,
    name: pc.name,
    label: "Strategic Scenario Indicators — not engineering predictions.",
    shocks: { homes, solarMw, batteryMwh, evChargers: evs, commercialMw },
    before,
    after,
    deltas: Object.fromEntries(Object.keys(before).map((k) => [k, Math.round((after[k] - before[k]) * 10) / 10])),
    method:
      "Additive index shifts from user-entered magnitudes. They illustrate direction of strategic interest, not voltage, thermal or protection outcomes.",
  };
}
