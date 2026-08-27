"""Transparent, spatially relative opportunity scoring.

Scores are percentile ranks within the selected network, then weighted.
They are strategic indicators, not engineering results.
"""

from __future__ import annotations

from typing import Any

SCORE_KIND_LABELS = {
    "flexibleExport": "Flexible Export Opportunity",
    "networkVisibility": "Network Visibility Opportunity",
    "connectionAssessment": "Connection Assessment Opportunity",
    "derOrchestration": "DER Orchestration Opportunity",
}


def percentile_ranks(values: list[float | None]) -> list[float | None]:
    paired = [(i, v) for i, v in enumerate(values) if v is not None]
    if not paired:
        return [None] * len(values)
    paired.sort(key=lambda x: x[1])
    n = len(paired)
    out: list[float | None] = [None] * len(values)
    if n == 1:
        out[paired[0][0]] = 50.0
        return out
    for rank, (i, _) in enumerate(paired):
        out[i] = 100.0 * rank / (n - 1)
    return out


def weighted_score(parts: dict[str, float | None], weights: dict[str, float]) -> tuple[float, dict[str, Any]]:
    usable = {k: v for k, v in parts.items() if v is not None and k in weights}
    if not usable:
        return 0.0, {"availableWeight": 0, "factors": parts, "note": "Insufficient evidence to score."}
    weight_sum = sum(weights[k] for k in usable)
    score = sum(usable[k] * weights[k] for k in usable) / weight_sum
    return round(score, 1), {
        "availableWeight": round(weight_sum, 3),
        "missingFactors": [k for k in weights if k not in usable],
        "factors": {k: (None if v is None else round(v, 1)) for k, v in parts.items()},
        "weightsUsed": {k: weights[k] for k in usable},
    }


def invert_rank(rank: float | None) -> float | None:
    if rank is None:
        return None
    return 100.0 - rank


def apply_weights(postcodes: list[dict[str, Any]], weights: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    def col(key: str) -> list[float | None]:
        return [p["metrics"].get(key) for p in postcodes]

    solar_intensity = percentile_ranks(col("solarKwPerAsset"))
    solar_growth = percentile_ranks(col("solarGrowthPct"))
    battery = percentile_ranks(col("batteryPerAsset"))
    lv_proxy = percentile_ranks(col("distSubstationsPerKm2"))
    growth = percentile_ranks(col("recentSolarInstallShare"))
    der_growth = percentile_ranks(col("solarGrowthPct"))
    network_density = percentile_ranks(col("distSubstationsPerKm2"))
    capacity_spread = percentile_ranks(col("availableKvaCv"))
    place_pressure = percentile_ranks(col("focusWeight"))
    # Low remaining load capacity should rank high: invert mean available kVA.
    low_capacity = [invert_rank(v) for v in percentile_ranks(col("meanAvailableKva"))]
    industrial = percentile_ranks(col("industrialCount"))
    asset_density = percentile_ranks(col("distSubstationCount"))
    demand_growth = percentile_ranks(col("heatPumpInstallsPerKm2"))
    zone_proximity = percentile_ranks(col("zoneSubstationCount"))
    ev_context = percentile_ranks(col("evChargerCount"))
    electrification = percentile_ranks(col("heatPumpInstallsPerKm2"))
    public_feeder_gap = [82.0 for _ in postcodes]  # public feeder polygons are not usable in this build

    for i, pc in enumerate(postcodes):
        flex_parts = {
            "solarIntensity": solar_intensity[i],
            "solarGrowth": solar_growth[i],
            "batteryAdoption": battery[i],
            "lvCongestionProxy": lv_proxy[i],
            "growthPressure": growth[i],
        }
        vis_parts = {
            "derGrowth": der_growth[i],
            "networkDensity": network_density[i],
            "publicFeederGap": public_feeder_gap[i],
            "capacitySpread": capacity_spread[i],
            "placePressure": place_pressure[i],
        }
        conn_parts = {
            "lowRemainingLoadCapacity": low_capacity[i],
            "industrialContext": industrial[i],
            "assetDensity": asset_density[i],
            "demandGrowthProxy": demand_growth[i],
            "zoneProximity": zone_proximity[i],
        }
        der_parts = {
            "solarIntensity": solar_intensity[i],
            "batteryAdoption": battery[i],
            "evContext": ev_context[i],
            "electrificationProxy": electrification[i],
        }
        flex, flex_x = weighted_score(flex_parts, weights["flexibleExport"])
        vis, vis_x = weighted_score(vis_parts, weights["networkVisibility"])
        conn, conn_x = weighted_score(conn_parts, weights["connectionAssessment"])
        der, der_x = weighted_score(der_parts, weights["derOrchestration"])
        pc["scores"] = {
            "flexibleExport": flex,
            "networkVisibility": vis,
            "connectionAssessment": conn,
            "derOrchestration": der,
            "composite": round((flex + vis + conn + der) / 4, 1),
        }
        pc["scoreExplain"] = {
            "flexibleExport": flex_x,
            "networkVisibility": vis_x,
            "connectionAssessment": conn_x,
            "derOrchestration": der_x,
        }
        pc["scoreCaveats"] = [
            "Percentile ranks are relative to other postcodes in this network bundle, not an absolute engineering scale.",
            "Public generation hosting / export headroom is not available and is not used.",
            "Available kVA is a load-capacity indicator only.",
        ]
    return postcodes
