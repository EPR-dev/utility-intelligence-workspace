from __future__ import annotations

from datetime import datetime
from typing import Any

from scoring.engine import SCORE_KIND_LABELS, apply_weights, weighted_score

DISCLAIMER = (
    "This analysis uses public data and provides exploratory strategic hypotheses only. "
    "Network engineering conclusions require utility-owned operational data and engineering validation."
)


def render_markdown(bundle: dict[str, Any], topic: str | None = None) -> str:
    acc = bundle["account"]
    cfg = bundle["config"]
    lines = [
        f"# Account brief — {cfg['name']}",
        "",
        f"_Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC_",
        "",
        f"> {DISCLAIMER}",
        "",
        f"**Affiliation:** {bundle.get('notAffiliated')}",
        "",
        "## Territory overview",
        "",
        cfg.get("description", ""),
        "",
        f"- Approximate customers: {acc['snapshot']['customers']}",
        f"- Public zone substations in bundle: {acc['snapshot']['zoneSubstationsPublic']}",
        f"- Postcodes with network assets: {acc['snapshot']['postcodesObserved']}",
        f"- CER solar systems (sum of postcodes in bundle): {acc['snapshot']['solarInstallsObserved']:,}",
        f"- CER batteries (from July 2025, sum): {acc['snapshot']['batteryInstallsObserved']:,}",
        "",
        "## Key spatial trends",
        "",
    ]
    for t in acc.get("themes", []):
        lines.append(f"- {t}")
    lines += ["", "## Top opportunity areas", ""]
    lines.append("| Area | Postcode | Flexible export | Visibility | Connections | Orchestration |")
    lines.append("|---|---|---:|---:|---:|---:|")
    for a in acc.get("topAreas", []):
        s = a["scores"]
        lines.append(
            f"| {a['name']} | {a['postcode']} | {s['flexibleExport']} | {s['networkVisibility']} | {s['connectionAssessment']} | {s['derOrchestration']} |"
        )
    lines += ["", "## Evidence used", ""]
    for s in bundle.get("sources", []):
        status = "connected" if s.get("status") == "connected" else "NOT YET CONNECTED"
        lines.append(f"- **{s['name']}** ({s.get('publisher')}) — {status}")
        if s.get("url"):
            lines.append(f"  - {s['url']}")
        if s.get("limitations"):
            lines.append(f"  - Limitation: {s['limitations']}")
        if s.get("note"):
            lines.append(f"  - {s['note']}")
    lines += ["", "## Likely customer questions", ""]
    for group, qs in acc.get("discoveryQuestions", {}).items():
        lines.append(f"### {group.title()}")
        for q in qs:
            lines.append(f"- {q}")
        lines.append("")
    lines += ["## Data gaps", ""]
    for g in acc.get("dataGaps", []):
        lines.append(f"- {g.get('name')}: {g.get('note') or 'Not connected'}")
    lines += [
        "",
        "## Potential next steps",
        "",
        "1. Pick one depot (Southern Highlands or Illawarra) for a scoped discovery workshop.",
        "2. Request a sample data pack: feeders, LV connectivity, DER register, AMI extract.",
        "3. Run that pack through Data Readiness before any product demonstration.",
        "4. Treat high public scores as conversation starters, not as a ranked sales list.",
        "",
    ]
    if topic:
        lines += [f"## Meeting topic: {topic}", ""]
    return "\n".join(lines) + "\n"


def meeting_pack(bundle: dict[str, Any], topic: str, postcode: str | None = None) -> dict[str, Any]:
    acc = bundle["account"]
    subject = None
    if postcode:
        subject = next((p for p in bundle["postcodes"] if p["postcode"] == postcode), None)
    known = [
        f"{bundle['config']['name']} public zone substations: {bundle['stats']['zoneSubstations']}.",
        "CER small-scale postcode statistics are connected for solar (and batteries from July 2025 where present).",
        "Distribution-substation remaining load capacity is published as avlbl_k and is not generation hosting capacity.",
    ]
    interesting = acc.get("themes", [])[:3]
    if subject:
        interesting = [
            f"{subject['name']} flexible-export indicator {subject['scores']['flexibleExport']}, "
            f"solar growth {subject['metrics']['solarGrowthPct']:.0f}%."
        ] + interesting
    dont = [
        s.get("note") or s["name"] for s in bundle.get("sources", []) if s.get("status") != "connected"
    ]
    topic_q = {
        "flexible exports": acc["discoveryQuestions"]["networkPlanning"] + acc["discoveryQuestions"]["operations"][:2],
        "grid visibility": acc["discoveryQuestions"]["data"] + acc["discoveryQuestions"]["networkPlanning"][:2],
        "connections": acc["discoveryQuestions"]["commercial"][:2] + [
            "Where do connection studies currently stall?",
            "Which supply points have the longest queue?",
        ],
        "orchestration": acc["discoveryQuestions"]["operations"] + acc["discoveryQuestions"]["implementation"][:2],
        "general discovery": [q for qs in acc["discoveryQuestions"].values() for q in qs[:1]],
    }
    key = topic.lower().strip()
    questions = topic_q.get(key, topic_q["general discovery"])
    return {
        "topic": topic,
        "subject": {"name": subject["name"], "postcode": subject["postcode"]} if subject else None,
        "whatWeKnow": known,
        "whatAppearsInteresting": interesting,
        "whatWeDontKnow": dont,
        "questionsToAsk": questions,
        "dataToRequest": [
            "One depot GIS extract with feeder and LV connectivity",
            "DER register for that depot",
            "Interval meter sample (daytime reverse-flow days)",
            "Connection queue snapshot",
            "Any existing hosting-capacity or flexible-export trial notes",
        ],
        "potentialNextStep": "Agree a two-week data-readiness exercise on a single depot rather than a network-wide platform discussion.",
        "disclaimer": DISCLAIMER,
    }


def reweight(bundle: dict[str, Any], weights: dict[str, dict[str, float]]) -> dict[str, Any]:
    postcodes = [dict(p, metrics=dict(p["metrics"])) for p in bundle["postcodes"]]
    apply_weights(postcodes, weights)
    ranked = sorted(postcodes, key=lambda p: p["scores"]["composite"], reverse=True)[:10]
    return {"weights": weights, "top": ranked, "labels": SCORE_KIND_LABELS}


def scenario_shift(bundle: dict[str, Any], postcode: str, shocks: dict[str, float]) -> dict[str, Any]:
    """Strategic scenario indicators only — no power flow."""
    pc = next((p for p in bundle["postcodes"] if p["postcode"] == postcode), None)
    if not pc:
        raise KeyError(postcode)
    before = dict(pc["scores"])
    # Map shocks onto the same 0–100 indicators with explicit fudge factors.
    homes = shocks.get("homes", 0)
    solar_mw = shocks.get("solarMw", 0)
    battery_mwh = shocks.get("batteryMwh", 0)
    evs = shocks.get("evChargers", 0)
    commercial_mw = shocks.get("commercialMw", 0)

    after = dict(before)
    after["flexibleExport"] = _clip(before["flexibleExport"] + 4.5 * solar_mw + 1.2 * battery_mwh + 0.01 * homes)
    after["networkVisibility"] = _clip(before["networkVisibility"] + 0.02 * homes + 2.0 * solar_mw + 1.5 * commercial_mw)
    after["connectionAssessment"] = _clip(before["connectionAssessment"] + 6.0 * commercial_mw + 0.015 * homes + 0.02 * evs)
    after["derOrchestration"] = _clip(before["derOrchestration"] + 3.5 * battery_mwh + 0.04 * evs + 2.0 * solar_mw)
    after["composite"] = round(sum(after[k] for k in ("flexibleExport", "networkVisibility", "connectionAssessment", "derOrchestration")) / 4, 1)
    return {
        "postcode": postcode,
        "name": pc["name"],
        "label": "Strategic Scenario Indicators — not engineering predictions.",
        "shocks": {
            "homes": homes,
            "solarMw": solar_mw,
            "batteryMwh": battery_mwh,
            "evChargers": evs,
            "commercialMw": commercial_mw,
        },
        "before": before,
        "after": after,
        "deltas": {k: round(after[k] - before[k], 1) for k in before},
        "method": (
            "Additive index shifts from user-entered magnitudes. "
            "They illustrate direction of strategic interest, not voltage, thermal or protection outcomes."
        ),
    }


def _clip(v: float) -> float:
    return round(max(0.0, min(100.0, v)), 1)


def compare(bundle: dict[str, Any], a: str, b: str) -> dict[str, Any]:
    pa = next(p for p in bundle["postcodes"] if p["postcode"] == a)
    pb = next(p for p in bundle["postcodes"] if p["postcode"] == b)
    keys = [
        ("solarInstallsTotal", "CER solar systems"),
        ("solarKwTotal", "CER solar kW"),
        ("solarGrowthPct", "Solar growth %"),
        ("batteryInstalls", "CER batteries"),
        ("distSubstationCount", "Distribution substations"),
        ("meanAvailableKva", "Mean remaining load kVA"),
        ("industrialCount", "OSM industrial features"),
        ("evChargerCount", "OSM EV chargers"),
    ]
    metrics = []
    for key, label in keys:
        metrics.append({"key": key, "label": label, "a": pa["metrics"].get(key), "b": pb["metrics"].get(key)})
    return {
        "a": {"postcode": pa["postcode"], "name": pa["name"], "region": pa["region"], "scores": pa["scores"]},
        "b": {"postcode": pb["postcode"], "name": pb["name"], "region": pb["region"], "scores": pb["scores"]},
        "metrics": metrics,
        "disclaimer": DISCLAIMER,
    }
