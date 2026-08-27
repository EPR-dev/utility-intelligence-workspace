"""Build the Endeavour Energy processed bundle from public sources.

Never writes back to data/raw after download; processed outputs live in data/processed.
"""

from __future__ import annotations

import csv
import io
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scoring.engine import apply_weights  # noqa: E402

RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed" / "endeavour-energy"
CONFIG_PATH = ROOT / "config" / "networks" / "endeavour-energy.json"
UA = {"User-Agent": "UtilityIntelligenceWorkspace/0.1 (internal research workstation)"}

CER_FILES = {
    "solar_installs": "https://cer.gov.au/document/sgu-solar-installations-2011-to-present-and-totals",
    "solar_capacity": "https://cer.gov.au/document/sgu-solar-capacity-2011-to-present-and-totals",
    "battery_installs": "https://cer.gov.au/document/sgu-battery-installations-2011-to-present-and-totals",
    "battery_capacity": "https://cer.gov.au/document/sgu-battery-capacity-2011-to-present-and-totals",
    "heatpump_installs": "https://cer.gov.au/document/swh-air-source-heat-pump-installations-2011-to-present-and-totals",
}

EE_BASE = "https://data.endeavourenergy.com.au/api/explore/v2.1"


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def http_get(url: str, timeout: int = 90, dest: str | None = None) -> bytes:
    if dest:
        path = RAW / dest
        if path.exists() and path.stat().st_size > 100:
            log(f"reuse raw {dest}")
            return path.read_bytes()
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    if dest:
        save_raw(dest, data)
    return data


def save_raw(name: str, data: bytes) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / name
    path.write_bytes(data)
    return path


def load_config() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def parse_cer_matrix(text: str) -> dict[str, dict[str, float]]:
    """Parse CER postcode CSV (monthly or yearly) into {postcode: {year: value, 'Total': n}}."""
    import re

    reader = csv.reader(io.StringIO(text))
    rows = [r for r in reader if r and any(c.strip() for c in r)]
    header_idx = None
    for i, row in enumerate(rows[:30]):
        joined = ",".join(row).lower()
        if "postcode" in joined:
            header_idx = i
            break
    if header_idx is None:
        raise ValueError("Could not find Postcode header in CER file")
    header = [c.strip() for c in rows[header_idx]]
    postcode_col = 0
    total_col = None
    historic_col = None
    year_by_idx: dict[int, int] = {}
    month_re = re.compile(
        r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})",
        re.I,
    )
    year_re = re.compile(r"\b(19|20)\d{2}\b")
    for i, name in enumerate(header):
        n = name.strip()
        low = n.lower()
        if "postcode" in low:
            postcode_col = i
            continue
        if "historic" in low:
            historic_col = i
            continue
        if low in {"total", "totals"} or (i == len(header) - 1 and "total" in low):
            total_col = i
            continue
        month = month_re.search(n)
        if month:
            year_by_idx[i] = int(month.group(2))
            continue
        if n.isdigit() and 1990 <= int(n) <= 2040:
            year_by_idx[i] = int(n)
            continue
        years_found = year_re.findall(n)
        # year_re.findall with group returns ['20'] — use search instead
        ym = re.search(r"\b((?:19|20)\d{2})\b", n)
        if ym and i not in year_by_idx:
            year_by_idx[i] = int(ym.group(1))
    out: dict[str, dict[str, float]] = {}
    for row in rows[header_idx + 1 :]:
        if len(row) <= postcode_col:
            continue
        pc = row[postcode_col].strip()
        if not pc or not pc[:4].isdigit():
            continue
        pc = pc[:4]
        yearly: dict[str, float] = {}
        for idx, year in year_by_idx.items():
            if idx < len(row) and row[idx].strip():
                yearly[str(year)] = yearly.get(str(year), 0.0) + _to_float(row[idx])
        if historic_col is not None and historic_col < len(row):
            yearly["2010"] = yearly.get("2010", 0.0) + _to_float(row[historic_col])
        rec = dict(yearly)
        if total_col is not None and total_col < len(row) and row[total_col].strip():
            rec["Total"] = _to_float(row[total_col])
        else:
            rec["Total"] = sum(yearly.values())
        out[pc] = rec
    return out


def _to_float(v: str) -> float:
    s = v.strip().replace(",", "")
    if s in {"", "-", "n/a", "na"}:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def fetch_cer() -> dict[str, dict[str, dict[str, float]]]:
    result: dict[str, dict[str, dict[str, float]]] = {}
    for key, url in CER_FILES.items():
        log(f"CER {key}")
        try:
            data = http_get(url, timeout=120, dest=f"cer_{key}.csv")
            if b"," not in data[:2000] and b"postcode" not in data[:2000].lower():
                log(f"  skip {key}: not a CSV ({data[:80]!r})")
                continue
            parsed = parse_cer_matrix(data.decode("utf-8", "ignore"))
            log(f"  {len(parsed)} postcodes")
            result[key] = parsed
        except Exception as exc:
            log(f"  FAILED {key}: {exc}")
    return result


def ee_export(dataset: str, fmt: str = "json", where: str | None = None) -> bytes:
    q = {"limit": "-1"}
    if where:
        q["where"] = where
    url = f"{EE_BASE}/catalog/datasets/{dataset}/exports/{fmt}?{urllib.parse.urlencode(q)}"
    log(f"Endeavour export {dataset} {fmt}")
    return http_get(url, timeout=180)


def fetch_zone_and_tx() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    cached = RAW / "endeavour_key_assets.json"
    if cached.exists():
        raw = cached.read_bytes()
        log("reuse raw endeavour_key_assets.json")
    else:
        raw = ee_export(
            "networkassets_otherassets",
            "json",
            'feature_type IN ("ZoneSubstation","TransmissionSubstation","HV_SwitchingStation")',
        )
        save_raw("endeavour_key_assets.json", raw)
    rows = json.loads(raw)
    zones, tx, hv = [], [], []
    for r in rows:
        item = {
            "id": r.get("asset_num") or str(r.get("g3e_fid")),
            "fid": r.get("g3e_fid"),
            "name": (r.get("asset_name") or r.get("city") or "Unnamed").title()
            if r.get("asset_name")
            else (r.get("city") or "Unnamed"),
            "featureType": r.get("feature_type"),
            "city": r.get("city"),
            "postcode": str(r.get("postcode") or "").zfill(4) if r.get("postcode") else None,
            "voltage": r.get("operating_voltage"),
            "feeder": r.get("feeder_num"),
            "address": r.get("streetaddress"),
            "state": r.get("state"),
            "lon": (r.get("geom") or {}).get("lon"),
            "lat": (r.get("geom") or {}).get("lat"),
        }
        if item["lon"] is None:
            continue
        ft = r.get("feature_type")
        if ft == "ZoneSubstation":
            zones.append(item)
        elif ft == "TransmissionSubstation":
            tx.append(item)
        else:
            hv.append(item)
    log(f"  zones={len(zones)} tx={len(tx)} hvSwitch={len(hv)}")
    return zones, tx, hv


def fetch_dist_substations() -> list[dict[str, Any]]:
    cached = RAW / "endeavour_distribution_substations.json"
    if cached.exists():
        raw = cached.read_bytes()
        log("reuse raw endeavour_distribution_substations.json")
    else:
        raw = ee_export(
            "networkassets_otherassets",
            "json",
            'feature_type="DistributionSubstation"',
        )
        save_raw("endeavour_distribution_substations.json", raw)
    rows = json.loads(raw)
    out = []
    for r in rows:
        geom = r.get("geom") or {}
        if geom.get("lon") is None:
            continue
        pc = str(r.get("postcode") or "").strip()
        if pc.isdigit():
            pc = pc.zfill(4)
        else:
            pc = None
        out.append(
            {
                "id": r.get("asset_num") or str(r.get("g3e_fid")),
                "postcode": pc,
                "city": r.get("city"),
                "lon": geom["lon"],
                "lat": geom["lat"],
                "voltage": r.get("operating_voltage"),
            }
        )
    log(f"  dist substations={len(out)}")
    return out


def fetch_capacity() -> list[dict[str, Any]]:
    cached = RAW / "endeavour_available_capacity.json"
    if cached.exists():
        raw = cached.read_bytes()
        log("reuse raw endeavour_available_capacity.json")
    else:
        raw = ee_export("distribution-substation-available-capacity", "json")
        save_raw("endeavour_available_capacity.json", raw)
    rows = json.loads(raw)
    out = []
    for r in rows:
        pt = r.get("geo_point_2d") or {}
        if pt.get("lon") is None:
            continue
        out.append(
            {
                "id": str(r.get("dsub") or r.get("objectid")),
                "availableKva": r.get("avlbl_k"),
                "lon": pt["lon"],
                "lat": pt["lat"],
            }
        )
    log(f"  capacity points={len(out)}")
    return out


def fetch_territory() -> dict[str, Any]:
    cached = RAW / "endeavour_distribution_district.geojson"
    if cached.exists():
        raw = cached.read_bytes()
        log("reuse raw endeavour_distribution_district.geojson")
    else:
        raw = ee_export("distribution-district", "geojson")
        save_raw("endeavour_distribution_district.geojson", raw)
    gj = json.loads(raw)
    return gj


def simplify_geojson(gj: dict[str, Any], tolerance: float = 0.003) -> dict[str, Any]:
    try:
        from shapely.geometry import mapping, shape
        from shapely.ops import unary_union
    except ImportError:
        log("shapely missing; territory not simplified")
        return gj
    geoms = [shape(f["geometry"]) for f in gj.get("features", []) if f.get("geometry")]
    if not geoms:
        return gj
    merged = unary_union(geoms)
    simplified = merged.simplify(tolerance, preserve_topology=True)
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Endeavour Energy distribution district", "source": "Endeavour Energy Open Data"},
                "geometry": mapping(simplified),
            }
        ],
    }


def poa_code_from_props(props: dict[str, Any]) -> str | None:
    for key in (
        "poa_code_2021",
        "POA_CODE_2021",
        "POA_CODE21",
        "POA_CODE2021",
        "POA_CODE",
        "poa_code21",
    ):
        if props.get(key) not in {None, ""}:
            code = str(props[key]).strip()
            if code.isdigit():
                return code.zfill(4)
    return None


def fetch_abs_poa(_postcodes: list[str]) -> dict[str, Any] | None:
    """Fetch ABS POA polygons intersecting the Endeavour bbox."""
    base = "https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0/query"
    features: list[dict[str, Any]] = []
    offset = 0
    try:
        while True:
            params = urllib.parse.urlencode(
                {
                    "where": "1=1",
                    "geometry": json.dumps(
                        {
                            "xmin": 149.62,
                            "ymin": -35.70,
                            "xmax": 151.16,
                            "ymax": -32.28,
                            "spatialReference": {"wkid": 4326},
                        }
                    ),
                    "geometryType": "esriGeometryEnvelope",
                    "inSR": "4326",
                    "spatialRel": "esriSpatialRelIntersects",
                    "outFields": "*",
                    "returnGeometry": "true",
                    "outSR": "4326",
                    "f": "geojson",
                    "resultOffset": str(offset),
                    "resultRecordCount": "200",
                }
            )
            data = json.loads(http_get(f"{base}?{params}", timeout=90))
            batch = data.get("features") or []
            features.extend(batch)
            log(f"ABS POA batch {len(batch)} (total {len(features)})")
            if len(batch) < 200:
                break
            offset += len(batch)
            time.sleep(0.15)
        if features:
            save_raw("abs_poa_endeavour.geojson", json.dumps({"type": "FeatureCollection", "features": features}).encode())
            return {"type": "FeatureCollection", "features": features}
    except Exception as exc:
        log(f"ABS bbox query failed: {exc}")
    return None


def fetch_overpass(bbox: tuple[float, float, float, float]) -> dict[str, Any]:
    south, west, north, east = bbox
    query = f"""
    [out:json][timeout:60];
    (
      nwr["landuse"="industrial"]({south},{west},{north},{east});
      nwr["landuse"="commercial"]({south},{west},{north},{east});
      nwr["amenity"="charging_station"]({south},{west},{north},{east});
      nwr["power"="substation"]({south},{west},{north},{east});
    );
    out center tags 400;
    """
    url = "https://overpass-api.de/api/interpreter"
    log("OSM Overpass (industrial / commercial / EV / power)")
    try:
        data = http_get(url + "?" + urllib.parse.urlencode({"data": query}), timeout=90)
        save_raw("osm_overpass.json", data)
        return json.loads(data)
    except Exception as exc:
        log(f"  Overpass failed: {exc}")
        return {"elements": []}


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def region_for(postcode: str, config: dict[str, Any]) -> str:
    for region, codes in config.get("regionHints", {}).items():
        if postcode in codes:
            return region
    n = int(postcode) if postcode.isdigit() else 0
    if 2575 <= n <= 2579:
        return "Southern Highlands"
    if 2500 <= n <= 2529:
        return "Illawarra"
    if 2530 <= n <= 2551:
        return "South Coast"
    if 2770 <= n <= 2787:
        return "Blue Mountains"
    if 2745 <= n <= 2770 or 2145 <= n <= 2179 or 2555 <= n <= 2574:
        return "Western Sydney"
    return "Other Endeavour"


def convex_hull_feature(points: list[tuple[float, float]], props: dict[str, Any]) -> dict[str, Any] | None:
    try:
        from shapely.geometry import MultiPoint, mapping
    except ImportError:
        return None
    if len(points) < 3:
        if not points:
            return None
        lon, lat = points[0]
        # small envelope
        d = 0.04
        coords = [
            [lon - d, lat - d],
            [lon + d, lat - d],
            [lon + d, lat + d],
            [lon - d, lat + d],
            [lon - d, lat - d],
        ]
        return {
            "type": "Feature",
            "properties": {**props, "geometryMethod": "indicative-envelope"},
            "geometry": {"type": "Polygon", "coordinates": [coords]},
        }
    hull = MultiPoint(points).convex_hull.buffer(0.008).simplify(0.002, preserve_topology=True)
    if hull.geom_type == "Polygon":
        geom = mapping(hull)
    else:
        geom = mapping(hull.convex_hull)
    return {
        "type": "Feature",
        "properties": {**props, "geometryMethod": "convex-hull-of-distribution-substations"},
        "geometry": geom,
    }


def osm_counts(elements: list[dict[str, Any]], lon: float, lat: float, radius_km: float = 8.0) -> dict[str, int]:
    counts = {"industrial": 0, "commercial": 0, "ev": 0, "osmSubstation": 0}
    for el in elements:
        center = el.get("center") or {}
        elon = center.get("lon", el.get("lon"))
        elat = center.get("lat", el.get("lat"))
        if elon is None or elat is None:
            continue
        if haversine_km(lon, lat, elon, elat) > radius_km:
            continue
        tags = el.get("tags") or {}
        if tags.get("landuse") == "industrial":
            counts["industrial"] += 1
        elif tags.get("landuse") == "commercial":
            counts["commercial"] += 1
        elif tags.get("amenity") == "charging_station":
            counts["ev"] += 1
        elif tags.get("power") == "substation":
            counts["osmSubstation"] += 1
    return counts


def cer_metrics(table: dict[str, dict[str, float]] | None, postcode: str) -> dict[str, float]:
    if not table or postcode not in table:
        return {"total": 0.0, "recent": 0.0, "prior": 0.0, "growthPct": 0.0, "timeline": {}}
    rec = table[postcode]
    years = {int(k): v for k, v in rec.items() if k.isdigit()}
    recent_years = [y for y in years if y >= 2022]
    prior_years = [y for y in years if 2018 <= y <= 2021]
    recent = sum(years[y] for y in recent_years)
    prior = sum(years[y] for y in prior_years)
    growth = ((recent - prior) / prior * 100.0) if prior > 0 else (100.0 if recent > 0 else 0.0)
    return {
        "total": rec.get("Total") or sum(years.values()),
        "recent": recent,
        "prior": prior,
        "growthPct": growth,
        "timeline": {str(y): years[y] for y in sorted(years)},
    }


def assign_points_to_poa(
    points: list[dict[str, Any]], abs_by_pc: dict[str, dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    from shapely.geometry import Point, shape
    from shapely.strtree import STRtree

    geoms = []
    codes: list[str] = []
    for code, feat in abs_by_pc.items():
        if not feat.get("geometry"):
            continue
        try:
            geoms.append(shape(feat["geometry"]))
            codes.append(code)
        except Exception:
            continue
    if not geoms:
        return {}
    tree = STRtree(geoms)
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in points:
        pt = Point(p["lon"], p["lat"])
        hits = tree.query(pt)
        assigned = None
        for i in hits:
            gi = geoms[int(i)]
            if gi.covers(pt) or gi.intersects(pt):
                assigned = codes[int(i)]
                break
        if assigned:
            grouped[assigned].append(p)
    return grouped


def assign_capacity_to_postcode(
    capacity: list[dict[str, Any]], centroids: dict[str, tuple[float, float]]
) -> dict[str, list[float]]:
    if not centroids:
        return {}
    items = list(centroids.items())
    grouped: dict[str, list[float]] = defaultdict(list)
    for c in capacity:
        kva = c.get("availableKva")
        if kva is None:
            continue
        lon, lat = c["lon"], c["lat"]
        best_pc, best_d = items[0][0], 1e9
        for pc, (clon, clat) in items:
            d = (lon - clon) ** 2 + (lat - clat) ** 2
            if d < best_d:
                best_d, best_pc = d, pc
        grouped[best_pc].append(float(kva))
    return grouped


def mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def stdev(xs: list[float]) -> float | None:
    if len(xs) < 2:
        return None
    m = mean(xs) or 0
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def area_sqkm_from_geom(geom: dict[str, Any] | None, fallback_points: int) -> float:
    if geom:
        try:
            from shapely.geometry import shape

            g = shape(geom)
            # geodesic approximation via WGS84 degrees
            return abs(g.area) * 111.32 * 111.32
        except Exception:
            pass
    return max(4.0, fallback_points * 0.35)


def build_why(pc: dict[str, Any], kind: str) -> list[str]:
    m = pc["metrics"]
    reasons = []
    if kind == "flexibleExport":
        if (m.get("solarKwPerKm2") or 0) > 0:
            reasons.append(f"rooftop solar intensity around {m['solarKwTotal']:.0f} kW cumulative STC-registered capacity in this postcode")
        if (m.get("solarGrowthPct") or 0) > 20:
            reasons.append(f"solar installations grew about {m['solarGrowthPct']:.0f}% comparing 2022–current vs 2018–2021")
        if (m.get("batteryInstalls") or 0) > 0:
            reasons.append(f"{int(m['batteryInstalls'])} STC-registered battery systems since the 2025 scheme start")
        if (m.get("distSubstationsPerKm2") or 0) > 0:
            reasons.append("relatively dense distribution-substation coverage, a proxy for LV network complexity")
        reasons.append("public generation hosting / export-limit data is not available, so this is not a constraint finding")
    elif kind == "networkVisibility":
        reasons.append("complete public feeder topology is not available for mapping, which itself is a visibility gap")
        if (m.get("solarGrowthPct") or 0) > 15:
            reasons.append("DER uptake is changing quickly relative to other Endeavour postcodes")
        if (m.get("availableKvaCv") or 0) > 0.8:
            reasons.append("wide spread in remaining distribution-substation load capacity, suggesting uneven local conditions")
        reasons.append("changing load and DER patterns are harder to manage without below-zone visibility")
    elif kind == "connectionAssessment":
        if m.get("meanAvailableKva") is not None:
            reasons.append(f"mean remaining distribution-substation load capacity near {m['meanAvailableKva']:.0f} kVA (indicative, not a connection offer)")
        if (m.get("industrialCount") or 0) > 0:
            reasons.append(f"{int(m['industrialCount'])} nearby OSM industrial land-use features")
        if (m.get("zoneSubstationCount") or 0) > 0:
            reasons.append(f"{int(m['zoneSubstationCount'])} zone substations in this postcode")
        reasons.append("large-load connection feasibility cannot be determined from public data alone")
    else:
        if (m.get("batteryInstalls") or 0) > 0:
            reasons.append("battery adoption is present in CER postcode statistics")
        if (m.get("evChargerCount") or 0) > 0:
            reasons.append(f"{int(m['evChargerCount'])} OSM charging-station features nearby")
        if (m.get("heatPumpInstalls") or 0) > 0:
            reasons.append("air-source heat-pump installations indicate electrification of hot water")
        reasons.append("orchestration value is a commercial hypothesis until interval, DOE and fleet data exist")
    return reasons[:6]


def questions_for(kind: str, name: str) -> list[str]:
    common = {
        "flexibleExport": [
            f"Are static export limits currently applied in the {name} area, and at what typical kW?",
            "Do you observe voltage rise or reverse-power issues during high solar periods on these feeders?",
            "Is CSIP-Aus / flexible export capability already enabled for this depot or zone?",
            "What visibility exists below the zone substation — AMI, transformer monitors, or neither?",
            "How current is the DER register relative to CER small-scale installation growth?",
            "Are dynamic operating envelopes in the current or next regulatory period plan?",
        ],
        "networkVisibility": [
            "How complete is GIS topology at LV, including customer-to-transformer mapping?",
            "What is the update cadence for as-built network models after new connections?",
            "Which planning areas have the largest gap between estimated and observed DER?",
            "Do field crews and planners share the same connectivity model?",
            "What percentage of distribution substations have real-time or periodic monitoring?",
            "Where do connection studies currently rely on assumed rather than measured load?",
        ],
        "connectionAssessment": [
            "What is the current connection queue for large loads in this area?",
            "How often do connection offers require upstream augmentation?",
            "Is remaining capacity published internally at feeder and zone level?",
            "Which industrial or commercial precincts are in the next five-year demand forecast?",
            "What data do connection applicants typically lack that slows studies?",
            "Are there known constrained supply points near this postcode?",
        ],
        "derOrchestration": [
            "What share of recent solar systems include a battery in this area?",
            "Do you have a view of controllable DER versus passive inverters?",
            "Is there a CSIP-Aus / utility server path for orchestration trials?",
            "Which tariffs or programs currently reward flexible demand or export?",
            "How are EV clusters being forecast at feeder level?",
            "What would a minimum viable orchestration dataset look like for this depot?",
        ],
    }
    return common[kind]


def customer_data_required(kind: str) -> list[str]:
    mapping = {
        "flexibleExport": [
            "Feeder and LV topology with customer connectivity",
            "Interval smart meter (AMI) data, especially daytime reverse flow",
            "Inverter export limits and DOE/CSIP-Aus status",
            "Voltage observations at distribution substations",
            "Authoritative DER register with install dates and capacity",
        ],
        "networkVisibility": [
            "GIS asset register with unique IDs and valid geometry",
            "Feeder-to-zone and LV-to-distribution-substation relationships",
            "Time-stamped topology change log",
            "Planning area / supply area polygons used internally",
            "Quality flags on estimated versus measured attributes",
        ],
        "connectionAssessment": [
            "Zone and feeder remaining capacity (load and generation, separately)",
            "Connection queue with requested kVA and status",
            "Committed development applications / large-load enquiries",
            "Protection and fault-level constraints where they bind offers",
            "Historical utilisation at the relevant supply point",
        ],
        "derOrchestration": [
            "DER register with device type, inverter make, and communications capability",
            "Battery state-of-charge or at least charge/discharge interval traces",
            "EV charger locations or circuit-level proxies",
            "Flexible-load program participation lists",
            "Operating envelope or constraint signal history",
        ],
    }
    return mapping[kind]


def solution_hypotheses(kind: str) -> list[str]:
    mapping = {
        "flexibleExport": [
            "Network visibility sufficient to support dynamic operating envelopes",
            "Flexible interconnection / flexible exports",
            "Improved DER register quality and forecasting",
        ],
        "networkVisibility": [
            "GIS and connectivity model cleanup as an implementation workstream",
            "Below-zone monitoring to reduce planning assumptions",
            "Shared operational/planning network model",
        ],
        "connectionAssessment": [
            "Faster, more consistent connection studies using a maintained network model",
            "Transparent remaining-capacity views for applicants (utility-owned data)",
            "Queue and augmentation planning support",
        ],
        "derOrchestration": [
            "DER orchestration once device-level visibility and communications exist",
            "Battery and EV flexibility programs coordinated with network constraints",
            "Customer-side flexibility as an alternative to some local augmentation — hypothesis only",
        ],
    }
    return mapping[kind]


def osm_feature_collection(elements: list[dict[str, Any]], kind: str) -> dict[str, Any]:
    feats = []
    for el in elements:
        tags = el.get("tags") or {}
        center = el.get("center") or {}
        lon = center.get("lon", el.get("lon"))
        lat = center.get("lat", el.get("lat"))
        if lon is None or lat is None:
            continue
        if kind == "industrial" and tags.get("landuse") != "industrial":
            continue
        if kind == "ev" and tags.get("amenity") != "charging_station":
            continue
        if kind == "commercial" and tags.get("landuse") != "commercial":
            continue
        feats.append(
            {
                "type": "Feature",
                "properties": {
                    "name": tags.get("name") or kind,
                    "source": "OpenStreetMap",
                    "licence": "ODbL",
                    "osmId": el.get("id"),
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
    return {"type": "FeatureCollection", "features": feats}


def points_geojson(items: list[dict[str, Any]], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    feats = []
    for it in items:
        feats.append(
            {
                "type": "Feature",
                "properties": {k: v for k, v in it.items() if k not in {"lon", "lat"}} | (extra or {}),
                "geometry": {"type": "Point", "coordinates": [it["lon"], it["lat"]]},
            }
        )
    return {"type": "FeatureCollection", "features": feats}


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    log(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


def main() -> None:
    t0 = time.time()
    config = load_config()
    PROCESSED.mkdir(parents=True, exist_ok=True)

    cer = fetch_cer()
    zones, tx, hv = fetch_zone_and_tx()
    dist = fetch_dist_substations()
    capacity = fetch_capacity()
    territory = simplify_geojson(fetch_territory())

    abs_poa = fetch_abs_poa([])
    abs_by_pc: dict[str, dict[str, Any]] = {}
    if abs_poa:
        log(f"ABS POA features {len(abs_poa['features'])}")
        for f in abs_poa["features"]:
            code = poa_code_from_props(f.get("properties") or {})
            if code:
                abs_by_pc[code] = f
        log(f"ABS POA codes {len(abs_by_pc)}")
    else:
        log("ABS POA not connected — using indicative envelopes from distribution substations")

    if abs_by_pc:
        by_pc = assign_points_to_poa(dist, abs_by_pc)
        cap_pts = assign_points_to_poa(capacity, abs_by_pc)
        cap_by_pc = {
            pc: [float(c["availableKva"]) for c in pts if c.get("availableKva") is not None]
            for pc, pts in cap_pts.items()
        }
        zones_by_pc = assign_points_to_poa(zones, abs_by_pc)
        log(f"spatially assigned dist substations to {len(by_pc)} postcodes")
    else:
        by_pc = defaultdict(list)
        for row in dist:
            if row.get("postcode"):
                by_pc[row["postcode"]].append(row)
        zones_by_pc = defaultdict(list)
        for z in zones:
            if z.get("postcode"):
                zones_by_pc[z["postcode"]].append(z)
        cap_by_pc = {}

    for z in zones:
        if z.get("postcode"):
            by_pc.setdefault(z["postcode"], [])
            zones_by_pc.setdefault(z["postcode"], [])
            if z not in zones_by_pc[z["postcode"]]:
                zones_by_pc[z["postcode"]].append(z)

    # Drop empty edge polygons with no network assets.
    by_pc = {k: v for k, v in by_pc.items() if v or zones_by_pc.get(k)}

    # Focus bbox: Southern Highlands + Illawarra
    osm = fetch_overpass((-35.05, 150.20, -34.20, 151.15))
    osm_elements = osm.get("elements") or []

    centroids: dict[str, tuple[float, float]] = {}
    for pc, rows in by_pc.items():
        if rows:
            centroids[pc] = (
                sum(r["lon"] for r in rows) / len(rows),
                sum(r["lat"] for r in rows) / len(rows),
            )
        else:
            zmatch = zones_by_pc.get(pc) or [z for z in zones if z.get("postcode") == pc]
            if zmatch:
                centroids[pc] = (zmatch[0]["lon"], zmatch[0]["lat"])
            elif pc in abs_by_pc:
                try:
                    from shapely.geometry import shape

                    c = shape(abs_by_pc[pc]["geometry"]).centroid
                    centroids[pc] = (c.x, c.y)
                except Exception:
                    centroids[pc] = (150.6, -34.5)

    if not cap_by_pc:
        cap_by_pc = assign_capacity_to_postcode(capacity, centroids)

    postcode_features = []
    postcodes_out: list[dict[str, Any]] = []
    focus_codes = {c for p in config["focusPlaces"] for c in p["postcodes"]}

    for pc, rows in sorted(by_pc.items()):
        lon, lat = centroids.get(pc, (150.6, -34.5))
        zone_here = zones_by_pc.get(pc) or [z for z in zones if z.get("postcode") == pc]
        cities = sorted({(r.get("city") or "").title() for r in rows if r.get("city")})
        if not cities:
            cities = sorted({(z.get("city") or z.get("name") or "").title() for z in zone_here if z.get("city") or z.get("name")})
        solar_i = cer_metrics(cer.get("solar_installs"), pc)
        solar_k = cer_metrics(cer.get("solar_capacity"), pc)
        bat_i = cer_metrics(cer.get("battery_installs"), pc)
        bat_k = cer_metrics(cer.get("battery_capacity"), pc)
        hp_i = cer_metrics(cer.get("heatpump_installs"), pc)
        kvas = cap_by_pc.get(pc) or []
        m_kva = mean(kvas)
        sd = stdev(kvas)
        cv = (sd / m_kva) if m_kva and sd is not None and m_kva > 0 else None
        osm_c = osm_counts(osm_elements, lon, lat)
        abs_feat = abs_by_pc.get(pc)
        geom = abs_feat["geometry"] if abs_feat else None
        area = area_sqkm_from_geom(geom, len(rows) or 1)
        if area <= 0:
            area = 8.0
        name = cities[0] if cities else f"Postcode {pc}"
        if pc == "2577":
            name = "Moss Vale / Robertson"
        elif pc == "2576":
            name = "Bowral"
        elif pc == "2575":
            name = "Mittagong"
        elif pc == "2500":
            name = "Wollongong"
        region = region_for(pc, config)
        metrics = {
            "solarInstallsTotal": solar_i["total"],
            "solarKwTotal": solar_k["total"] if solar_k["total"] else solar_i["total"],
            "solarInstallsRecent": solar_i["recent"],
            "solarGrowthPct": solar_i["growthPct"],
            "recentSolarInstallShare": (solar_i["recent"] / solar_i["total"] * 100.0) if solar_i["total"] else 0.0,
            "batteryInstalls": bat_i["total"],
            "batteryKwh": bat_k["total"],
            "heatPumpInstalls": hp_i["total"],
            "distSubstationCount": len(rows),
            "zoneSubstationCount": len(zone_here),
            "meanAvailableKva": m_kva,
            "minAvailableKva": min(kvas) if kvas else None,
            "availableKvaCv": cv,
            "capacitySampleCount": len(kvas),
            "areaSqKm": round(area, 2),
            "solarKwPerKm2": (solar_k["total"] or solar_i["total"]) / area,
            "solarKwPerAsset": (solar_k["total"] or solar_i["total"]) / max(len(rows), 1),
            "batteryInstallsPerKm2": bat_i["total"] / area,
            "batteryPerAsset": bat_i["total"] / max(len(rows), 1),
            "distSubstationsPerKm2": len(rows) / area,
            "heatPumpInstallsPerKm2": hp_i["total"] / area,
            "industrialCount": osm_c["industrial"],
            "commercialCount": osm_c["commercial"],
            "evChargerCount": osm_c["ev"],
            "focusWeight": 1.0 if pc in focus_codes else 0.2,
            "centroid": [lon, lat],
            "solarTimeline": solar_i["timeline"],
            "batteryTimeline": bat_i["timeline"],
        }
        rec = {
            "id": pc,
            "postcode": pc,
            "name": name,
            "localities": cities[:8],
            "region": region,
            "metrics": metrics,
            "geometrySource": "ABS POA 2021" if abs_feat else "indicative envelope from Endeavour distribution substations",
        }
        postcodes_out.append(rec)
        feat_geom = geom
        if feat_geom:
            try:
                from shapely.geometry import mapping, shape

                feat_geom = mapping(shape(feat_geom).simplify(0.0015, preserve_topology=True))
            except Exception:
                pass
        if not feat_geom:
            hull = convex_hull_feature([(r["lon"], r["lat"]) for r in rows] or [(lon, lat)], {"postcode": pc, "name": name})
            feat_geom = hull["geometry"] if hull else None
        if feat_geom:
            postcode_features.append(
                {
                    "type": "Feature",
                    "properties": {"postcode": pc, "name": name, "region": region},
                    "geometry": feat_geom,
                }
            )

    apply_weights(postcodes_out, config["scoring"])

    # attach scores onto geojson properties
    score_by_pc = {p["postcode"]: p for p in postcodes_out}
    for f in postcode_features:
        p = score_by_pc[f["properties"]["postcode"]]
        f["properties"].update(
            {
                "flexibleExport": p["scores"]["flexibleExport"],
                "networkVisibility": p["scores"]["networkVisibility"],
                "connectionAssessment": p["scores"]["connectionAssessment"],
                "derOrchestration": p["scores"]["derOrchestration"],
                "composite": p["scores"]["composite"],
                "solarKwTotal": p["metrics"]["solarKwTotal"],
                "solarGrowthPct": p["metrics"]["solarGrowthPct"],
                "batteryInstalls": p["metrics"]["batteryInstalls"],
                "meanAvailableKva": p["metrics"]["meanAvailableKva"],
                "distSubstationCount": p["metrics"]["distSubstationCount"],
            }
        )

    opportunities = []
    focus_codes = {c for p in config["focusPlaces"] for c in p["postcodes"]}
    for kind in ["flexibleExport", "networkVisibility", "connectionAssessment", "derOrchestration"]:
        ranked = sorted(postcodes_out, key=lambda p: p["scores"][kind], reverse=True)
        chosen = ranked[:10]
        for p in postcodes_out:
            if p["postcode"] in focus_codes and p not in chosen:
                chosen.append(p)
        seen = set()
        for p in chosen:
            if (kind, p["postcode"]) in seen:
                continue
            seen.add((kind, p["postcode"]))
            opportunities.append(
                {
                    "id": f"{kind}-{p['postcode']}",
                    "postcode": p["postcode"],
                    "name": p["name"],
                    "region": p["region"],
                    "kind": kind,
                    "score": p["scores"][kind],
                    "scores": p["scores"],
                    "explain": p["scoreExplain"][kind],
                    "whySurfaced": build_why(p, kind),
                    "whyItMatters": why_it_matters(kind, p),
                    "questions": questions_for(kind, p["name"]),
                    "customerDataRequired": customer_data_required(kind),
                    "solutionHypotheses": solution_hypotheses(kind),
                    "metrics": p["metrics"],
                    "geometrySource": p["geometrySource"],
                    "centroid": p["metrics"]["centroid"],
                }
            )

    sources = build_sources(cer, abs_poa is not None, bool(osm_elements))
    account = build_account(config, postcodes_out, zones, opportunities, sources)

    bundle = {
        "networkId": config["id"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "disclaimer": (
            "This analysis uses public data and provides exploratory strategic hypotheses only. "
            "Network engineering conclusions require utility-owned operational data and engineering validation."
        ),
        "notAffiliated": config["notAffiliatedNotice"],
        "config": {
            "name": config["name"],
            "map": config["map"],
            "focusPlaces": config["focusPlaces"],
            "scoring": config["scoring"],
            "notes": config["notes"],
            "customersApproximate": config["customersApproximate"],
            "serviceAreaSqKm": config["serviceAreaSqKm"],
            "jurisdiction": config["jurisdiction"],
            "description": config["description"],
        },
        "account": account,
        "postcodes": postcodes_out,
        "opportunities": opportunities,
        "places": config["focusPlaces"],
        "sources": sources,
        "glossary": glossary(),
        "stats": {
            "postcodes": len(postcodes_out),
            "zoneSubstations": len(zones),
            "transmissionSubstations": len(tx),
            "hvSwitchingStations": len(hv),
            "distributionSubstations": len(dist),
            "capacityPoints": len(capacity),
            "buildSeconds": round(time.time() - t0, 1),
            "cerDatasets": list(cer.keys()),
            "absPoaConnected": abs_poa is not None,
            "osmElements": len(osm_elements),
        },
    }

    write_json(PROCESSED / "bundle.json", bundle)
    write_json(PROCESSED / "territory.geojson", territory)
    write_json(PROCESSED / "postcodes.geojson", {"type": "FeatureCollection", "features": postcode_features})
    write_json(PROCESSED / "zone_substations.geojson", points_geojson(zones, {"layer": "zoneSubstation"}))
    write_json(PROCESSED / "transmission_substations.geojson", points_geojson(tx, {"layer": "transmissionSubstation"}))
    write_json(PROCESSED / "hv_switching.geojson", points_geojson(hv, {"layer": "hvSwitching"}))
    write_json(PROCESSED / "industrial.geojson", osm_feature_collection(osm_elements, "industrial"))
    write_json(PROCESSED / "ev_charging.geojson", osm_feature_collection(osm_elements, "ev"))
    write_json(PROCESSED / "commercial.geojson", osm_feature_collection(osm_elements, "commercial"))
    write_json(PROCESSED / "sources.json", sources)
    log(f"done in {time.time() - t0:.1f}s")


def why_it_matters(kind: str, p: dict[str, Any]) -> str:
    name = p["name"]
    if kind == "flexibleExport":
        return (
            f"{name} shows relatively strong rooftop solar activity in public CER statistics. "
            "For a DNSP, that pattern is worth a discovery conversation about export limits, voltage management "
            "and whether flexible exports would reduce customer curtailment — but only utility operational data can confirm a constraint."
        )
    if kind == "networkVisibility":
        return (
            f"Public network information around {name} is incomplete below zone-substation level. "
            "Where DER and development are also moving, poor topology visibility usually shows up as slower studies, "
            "weaker forecasts and harder conversations between planning and connections teams."
        )
    if kind == "connectionAssessment":
        return (
            f"{name} combines remaining load-capacity signals and/or nearby industrial or commercial land use. "
            "That is a reason to ask about the connection queue and study bottlenecks, not a finding that capacity is exhausted."
        )
    return (
        f"Solar, batteries and electrification proxies around {name} suggest a future flexibility stack. "
        "Orchestration only becomes a real product conversation once the utility can see and signal to devices."
    )


def build_sources(cer: dict[str, Any], abs_ok: bool, osm_ok: bool) -> list[dict[str, Any]]:
    sources = [
        {
            "id": "ee-opendata",
            "name": "Endeavour Energy Open Data (Peclet / Opendatasoft)",
            "publisher": "Endeavour Energy",
            "url": "https://data.endeavourenergy.com.au/",
            "license": "Open Database License (ODbL) for most network asset datasets; some datasets have no declared licence.",
            "updated": "Portal harvest during bundle build (assets refresh daily; capacity dataset less frequent).",
            "coverage": "Endeavour Energy distribution district, NSW",
            "fieldsUsed": ["feature_type", "asset_name", "postcode", "geom", "operating_voltage", "avlbl_k", "geo_shape"],
            "limitations": "Not an operational model. Available capacity is not generation hosting capacity. Conductor and pole layers are too large for this workstation and are not loaded.",
            "status": "connected",
        },
        {
            "id": "cer-sres",
            "name": "Small-scale installation postcode data (SRES)",
            "publisher": "Clean Energy Regulator",
            "url": "https://cer.gov.au/markets/reports-and-data/small-scale-installation-postcode-data",
            "license": "© Commonwealth of Australia. Check CER website for reuse terms; attribute the Clean Energy Regulator.",
            "updated": "Monthly. Current extract retrieved during bundle build. Latest years remain incomplete because of the 12-month STC creation window.",
            "coverage": "Australian postcodes; filtered to Endeavour postcodes observed on network assets.",
            "fieldsUsed": ["Postcode", "year columns", "Total"],
            "limitations": "Counts STC-registered systems, including upgrades and off-grid. Not identical to connected inverters on Endeavour's network. Battery series starts July 2025.",
            "status": "connected" if cer else "not_connected",
            "connectedDatasets": list(cer.keys()),
        },
        {
            "id": "abs-poa",
            "name": "ASGS Postal Areas (POA)",
            "publisher": "Australian Bureau of Statistics",
            "url": "https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3",
            "license": "Creative Commons Attribution 4.0 International",
            "updated": "ASGS Edition 3 / 2021 postal areas",
            "coverage": "Australia; subset attempted for Endeavour postcodes",
            "fieldsUsed": ["POA code", "geometry"],
            "limitations": "POA is not identical to Australia Post delivery postcodes in every case.",
            "status": "connected" if abs_ok else "not_connected",
            "note": None if abs_ok else "Data source not yet connected. Indicative envelopes from distribution substation locations are used instead.",
        },
        {
            "id": "osm",
            "name": "OpenStreetMap contextual features",
            "publisher": "OpenStreetMap contributors",
            "url": "https://www.openstreetmap.org/",
            "license": "ODbL. © OpenStreetMap contributors.",
            "updated": "Live Overpass extract during bundle build",
            "coverage": "Southern Highlands and Illawarra bounding box used for V1 context layers",
            "fieldsUsed": ["landuse=industrial", "landuse=commercial", "amenity=charging_station"],
            "limitations": "Volunteer geography. Completeness varies. Not a land-use zoning dataset.",
            "status": "connected" if osm_ok else "not_connected",
        },
        {
            "id": "abs-census",
            "name": "ABS Census dwelling and population by POA",
            "publisher": "Australian Bureau of Statistics",
            "url": "https://www.abs.gov.au/census",
            "license": "CC BY 4.0",
            "updated": None,
            "coverage": "Endeavour postal areas",
            "fieldsUsed": [],
            "limitations": "Required for true solar penetration and demographic growth.",
            "status": "not_connected",
            "note": "Data source not yet connected. Growth pressure currently uses CER installation mix as a weak proxy only.",
        },
        {
            "id": "nsw-planning",
            "name": "NSW planning / development applications",
            "publisher": "NSW Government",
            "url": "https://data.nsw.gov.au/",
            "license": "varies",
            "status": "not_connected",
            "note": "Data source not yet connected. Industrial/commercial OSM tags are a weak substitute.",
            "fieldsUsed": [],
            "coverage": "NSW",
            "limitations": "Would improve connection-assessment scoring.",
        },
        {
            "id": "ee-hosting",
            "name": "Generation hosting / flexible export limits",
            "publisher": "Endeavour Energy",
            "url": "https://www.endeavourenergy.com.au/our-network",
            "license": None,
            "status": "not_connected",
            "note": "Data source not yet connected. Do not interpret opportunity scores as identified export constraints.",
            "fieldsUsed": [],
            "coverage": "Endeavour network",
            "limitations": "This is the critical missing dataset for Flexible Export validation.",
        },
    ]
    return sources


def build_account(config, postcodes, zones, opportunities, sources):
    top_solar = sorted(postcodes, key=lambda p: p["metrics"]["solarKwTotal"] or 0, reverse=True)[:5]
    top_growth = sorted(postcodes, key=lambda p: p["metrics"]["solarGrowthPct"] or 0, reverse=True)[:5]
    focus = [p for p in postcodes if p["metrics"]["focusWeight"] >= 1]
    themes = []
    if top_solar:
        names = ", ".join(f"{p['name']} ({p['postcode']})" for p in top_solar[:3])
        themes.append(
            f"Rooftop solar capacity in public CER statistics is relatively concentrated around {names}. "
            "That is a prompt to investigate export policy and LV visibility, not proof of constraint."
        )
    if focus:
        highlands = [p for p in focus if p["region"] == "Southern Highlands"]
        illawarra = [p for p in focus if p["region"] == "Illawarra"]
        if highlands:
            themes.append(
                "The Southern Highlands cluster (Mittagong, Bowral, Moss Vale / Robertson) is a useful discovery slice: "
                "peri-urban growth, high residential solar, and a smaller number of zone substations than Western Sydney."
            )
        if illawarra:
            themes.append(
                "The Illawarra combines a dense coastal city (Wollongong) with industrial land use around Port Kembla. "
                "Connection assessment and DER orchestration questions will not be the same conversation as in the Highlands."
            )
    themes.append(
        "Public feeder topology is not loaded in this workstation. That gap is material: most GridSight-like value "
        "lives below the zone substation, and that is exactly where public data is weakest."
    )
    ranked = sorted(postcodes, key=lambda p: p["scores"]["composite"], reverse=True)[:8]
    return {
        "name": config["name"],
        "snapshot": {
            "serviceArea": config["description"],
            "customers": config["customersApproximate"],
            "geographicCoverage": config["jurisdiction"],
            "zoneSubstationsPublic": len(zones),
            "postcodesObserved": len(postcodes),
            "solarInstallsObserved": round(sum(p["metrics"]["solarInstallsTotal"] for p in postcodes)),
            "batteryInstallsObserved": round(sum(p["metrics"]["batteryInstalls"] for p in postcodes)),
            "majorCentres": [p["name"] for p in config["focusPlaces"] if p["kind"] in {"town", "city"}],
        },
        "themes": themes,
        "topAreas": [
            {
                "postcode": p["postcode"],
                "name": p["name"],
                "region": p["region"],
                "scores": p["scores"],
                "solarKwTotal": p["metrics"]["solarKwTotal"],
                "solarGrowthPct": p["metrics"]["solarGrowthPct"],
            }
            for p in ranked
        ],
        "topSolar": [{"name": p["name"], "postcode": p["postcode"], "kW": p["metrics"]["solarKwTotal"]} for p in top_solar],
        "topGrowth": [
            {"name": p["name"], "postcode": p["postcode"], "growthPct": p["metrics"]["solarGrowthPct"]} for p in top_growth
        ],
        "suggestedConversations": [
            "Flexible exports and CSIP-Aus readiness",
            "Connection queue and study cycle time",
            "GIS / topology data quality below zone substations",
            "DER forecasting versus observed CER growth",
            "EV and electrification load growth in the Illawarra",
            "Network planning inputs for Southern Highlands growth",
            "AMI coverage and voltage visibility",
            "Implementation path: what data would be shared first",
        ],
        "discoveryQuestions": {
            "commercial": [
                "Which planning areas are you most worried about missing in the next regulatory reset?",
                "Where do connection delays create the most customer and political pressure?",
                "What would a successful 12-month visibility or flexible-export outcome look like?",
            ],
            "networkPlanning": [
                "How do you currently estimate hosting and remaining load capacity at feeder level?",
                "Where is DER growth outpacing the planning model?",
                "Which zone substations have the least confidence in downstream connectivity?",
            ],
            "operations": [
                "What operational symptoms (voltage, reverse power, protection) are already visible?",
                "Do control room and field systems share identifiers with GIS?",
                "How are flexible-export or backstop events logged today?",
            ],
            "data": [
                "What is the system of record for topology, and how often is it rebuilt?",
                "Can we obtain a sample feeder model plus matching AMI and DER extract under NDA?",
                "Which identifiers would we use to join customers, transformers and inverters?",
            ],
            "implementation": [
                "Who owns GIS, ADMS, metering and DER data internally?",
                "What cyber and privacy constraints apply to a first data share?",
                "Is there an existing data-quality or digital-twin programme we should not duplicate?",
            ],
        },
        "dataGaps": [s for s in sources if s.get("status") == "not_connected"],
    }


def glossary() -> dict[str, str]:
    return {
        "DER": "Distributed Energy Resources: customer-scale generation and storage such as rooftop solar and batteries, plus some flexible loads.",
        "DNSP": "Distribution Network Service Provider — the company that owns and operates the poles-and-wires network. Endeavour Energy is a DNSP.",
        "feeder": "A high-voltage circuit leaving a zone substation that supplies a local area. Public feeder polygons are not used in this build.",
        "zone substation": "A bulk supply point that steps transmission or sub-transmission voltage down to 11 or 22 kV distribution. This app maps Endeavour's public zone substations.",
        "distribution substation": "A local transformer (often a kiosk, pole-top or chamber) that supplies low-voltage customers. Public point locations exist; connectivity does not.",
        "hosting capacity": "How much additional generation a part of the network can accept before technical limits are reached. Not published in the datasets used here.",
        "flexible exports": "Allowing a solar or battery inverter's export limit to vary with network conditions, instead of a low fixed cap.",
        "dynamic operating envelope": "A time-varying import/export limit sent to a customer device, usually derived from a network model plus measurements.",
        "SCADA": "Supervisory Control and Data Acquisition — real-time operational telemetry, typically at zone substations and some automated switches, not at every customer.",
        "AMI": "Advanced Metering Infrastructure — interval smart meters. Essential for seeing daytime reverse flow and validating export issues.",
        "topology": "Which assets are electrically connected to which. A map of poles is not a topology model.",
        "curtailment": "Reducing generation (or load) so the network stays within limits. Flexible exports are one way to curtail fairly rather than with a blunt static cap.",
        "CSIP-Aus": "Common Smart Inverter Profile — Australia. The communications profile used for utility-to-inverter signalling, including flexible exports.",
        "available capacity (avlbl_k)": "Endeavour's public remaining capacity figure at distribution substations. Treated here as a load-capacity indicator, not export headroom.",
    }


if __name__ == "__main__":
    main()
