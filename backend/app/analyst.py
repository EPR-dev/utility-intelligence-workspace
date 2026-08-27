"""Evidence-aware Grid Analyst.

Answers are assembled from the processed bundle only.
Every response separates observed evidence from hypothesis.
"""

from __future__ import annotations

import re
from typing import Any


def analyse(question: str, bundle: dict[str, Any], postcode: str | None = None) -> dict[str, Any]:
    q = question.strip()
    q_l = q.lower()
    citations: list[dict[str, Any]] = []
    observed: list[str] = []
    hypothesis: list[str] = []
    unknown: list[str] = []

    def cite(source_id: str, field: str, note: str) -> None:
        src = next((s for s in bundle.get("sources", []) if s["id"] == source_id), None)
        citations.append(
            {
                "sourceId": source_id,
                "dataset": (src or {}).get("name"),
                "publisher": (src or {}).get("publisher"),
                "field": field,
                "note": note,
                "status": (src or {}).get("status"),
            }
        )

    postcodes = bundle.get("postcodes", [])
    target = None
    if postcode:
        target = next((p for p in postcodes if p["postcode"] == postcode), None)
    if target is None:
        m = re.search(r"\b(\d{4})\b", q)
        if m:
            target = next((p for p in postcodes if p["postcode"] == m.group(1)), None)
    for place in ["robertson", "bowral", "moss vale", "wollongong", "mittagong", "kiama", "nowra"]:
        if place in q_l:
            target = next((p for p in postcodes if place in p["name"].lower() or place in " ".join(p.get("localities") or []).lower()), target)

    if any(w in q_l for w in ["fastest", "growing", "growth", "der area"]):
        ranked = sorted(postcodes, key=lambda p: p["metrics"].get("solarGrowthPct") or 0, reverse=True)[:5]
        for p in ranked:
            observed.append(
                f"{p['name']} ({p['postcode']}): CER solar installations changed about {p['metrics']['solarGrowthPct']:.0f}% "
                f"when comparing 2022–current with 2018–2021 ({int(p['metrics']['solarInstallsRecent'])} recent systems in the public file)."
            )
        cite("cer-sres", "year columns 2018–current", "Growth is STC registration counts, not connected-inverter counts.")
        hypothesis.append(
            "If those postcodes also have limited export capacity, this growth would increase the value of flexible exports. "
            "That capacity condition is not in the public bundle."
        )
        unknown.append("Feeder-level export limits, voltage traces and the utility DER register.")

    elif any(w in q_l for w in ["investigate", "opportunit", "where should", "deserve"]):
        ranked = sorted(postcodes, key=lambda p: p["scores"]["composite"], reverse=True)[:6]
        for p in ranked:
            observed.append(
                f"{p['name']} ({p['postcode']}) composite indicator {p['scores']['composite']} "
                f"(flexible export {p['scores']['flexibleExport']}, visibility {p['scores']['networkVisibility']}, "
                f"connections {p['scores']['connectionAssessment']}, orchestration {p['scores']['derOrchestration']})."
            )
        cite("ee-opendata", "zone substations + available kVA", "Scores are percentile ranks inside this network, not engineering grades.")
        cite("cer-sres", "installations and capacity", "DER intensity inputs.")
        hypothesis.append("These locations are the most distinctive in the public pattern, so they are the best places to start a customer conversation.")
        unknown.append("Whether any of these areas are actually constrained, queued, or already covered by a utility programme.")

    elif "question" in q_l or "planning manager" in q_l or "ask" in q_l:
        observed.append("The public bundle contains zone substations, distribution-substation locations, remaining load-capacity points, and CER postcode DER statistics.")
        cite("ee-opendata", "asset inventory", "What we can see without an NDA.")
        hypothesis.append("A network planning manager will care about model confidence, DER forecast error, and where connection studies are slow — not about a public choropleth.")
        unknown.extend(
            [
                "Which zone substations they consider poorly observed.",
                "Whether AMI is usable for planning in the Southern Highlands and Illawarra.",
                "What they already use for hosting-capacity or flexible-export trials.",
            ]
        )
        return {
            "question": q,
            "observed": observed,
            "hypothesis": hypothesis,
            "unknown": unknown,
            "questionsToAsk": bundle["account"]["discoveryQuestions"]["networkPlanning"],
            "citations": citations,
            "disclaimer": bundle["disclaimer"],
            "subject": target,
        }

    elif "battery" in q_l or "orchestr" in q_l:
        ranked = sorted(postcodes, key=lambda p: p["metrics"].get("batteryInstalls") or 0, reverse=True)[:5]
        if not any(p["metrics"].get("batteryInstalls") for p in ranked):
            observed.append("CER battery postcode statistics are present only from July 2025. If totals are zero, the extract may not have included this network's postcodes yet, or uptake is still thin.")
        for p in ranked:
            if p["metrics"].get("batteryInstalls"):
                observed.append(
                    f"{p['name']} ({p['postcode']}): {int(p['metrics']['batteryInstalls'])} STC-registered batteries; orchestration indicator {p['scores']['derOrchestration']}."
                )
        cite("cer-sres", "SGU-Battery installations", "Scheme start 1 July 2025; pending STCs are excluded.")
        hypothesis.append("Battery orchestration becomes commercially interesting where solar is already dense and the utility can signal devices. Public data can only flag the first of those conditions.")
        unknown.append("CSIP-Aus device counts, tariff arrangements, and constraint hours.")

    elif "data" in q_l and any(w in q_l for w in ["need", "additional", "require", "missing"]):
        observed.append("Connected public sources: Endeavour open network assets and capacity, CER small-scale postcode files, optional OSM context, optional ABS POA geometry.")
        for s in bundle.get("sources", []):
            if s.get("status") == "not_connected":
                unknown.append(f"{s['name']}: {s.get('note') or 'not connected'}")
        cite("ee-hosting", "generation hosting", "Not connected.")
        hypothesis.append("A first NDA data pack of one depot — feeders, LV connectivity, AMI, DER register — would tell us whether any high-scoring postcode is a real product opportunity.")

    elif target is not None and ("why" in q_l or "score" in q_l or "flexible" in q_l or target):
        p = target
        exp = p.get("scoreExplain", {}).get("flexibleExport", {})
        observed.append(
            f"{p['name']} ({p['postcode']}) flexible-export indicator is {p['scores']['flexibleExport']} / 100 (percentile mix inside Endeavour postcodes)."
        )
        factors = exp.get("factors") or {}
        observed.append(
            "Factor ranks: "
            + ", ".join(f"{k} {v}" for k, v in factors.items() if v is not None)
        )
        observed.append(
            f"CER solar systems (total in file) {int(p['metrics']['solarInstallsTotal'])}; recent-period systems {int(p['metrics']['solarInstallsRecent'])}; "
            f"growth {p['metrics']['solarGrowthPct']:.0f}%; batteries {int(p['metrics']['batteryInstalls'])}."
        )
        if p["metrics"].get("meanAvailableKva") is not None:
            observed.append(
                f"Mean remaining distribution-substation load capacity assigned to this postcode is about {p['metrics']['meanAvailableKva']:.0f} kVA. "
                "That is not export headroom."
            )
        cite("cer-sres", "SGU-Solar installations / capacity", "Postcode-level STC statistics.")
        cite("ee-opendata", "avlbl_k", "Load-capacity indicator only.")
        hypothesis.append(
            f"If export capacity is limited around {p['name']}, this DER pattern would support a flexible-export and visibility discussion. "
            "The public bundle cannot confirm that 'if'."
        )
        unknown.append("Actual export limits, voltage performance, and DOE/CSIP-Aus status for this area.")

    else:
        observed.append(
            f"Loaded network: {bundle['config']['name']}. "
            f"{bundle['stats']['postcodes']} postcodes, {bundle['stats']['zoneSubstations']} public zone substations."
        )
        observed.append("Ask about fastest-growing DER areas, why a town scored highly, questions for a planning manager, or missing data.")
        hypothesis.append("The workstation is for discovery, not for answering unasked engineering questions.")
        unknown.append("Anything below the public zone-substation layer.")

    return {
        "question": q,
        "observed": observed,
        "hypothesis": hypothesis,
        "unknown": unknown,
        "citations": citations,
        "disclaimer": bundle["disclaimer"],
        "subject": {"postcode": target["postcode"], "name": target["name"]} if target else None,
    }
