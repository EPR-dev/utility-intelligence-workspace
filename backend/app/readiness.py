"""Data readiness inspection for CSV, GeoJSON and GeoPackage uploads."""

from __future__ import annotations

import csv
import io
import json
import math
import zipfile
from datetime import datetime
from typing import Any

from . import SCHEMAS

USE_CASES = {
    "flexible_exports": {
        "label": "Flexible Exports",
        "needed": [
            "feeder topology",
            "substation assets",
            "DER register",
            "interval smart meter data",
            "voltage observations",
            "inverter export limits",
        ],
    },
    "network_visibility": {
        "label": "Network Visibility",
        "needed": [
            "GIS asset files",
            "feeder topology",
            "substation assets",
            "customer-to-network location",
            "topology update metadata",
        ],
    },
    "connections": {
        "label": "Connection Assessment",
        "needed": [
            "substation assets",
            "feeder topology",
            "remaining capacity",
            "connection queue",
            "large-load enquiries",
        ],
    },
    "orchestration": {
        "label": "DER Orchestration",
        "needed": [
            "DER register",
            "interval smart meter data",
            "inverter export limits",
            "battery / EV identifiers",
            "constraint signals",
        ],
    },
}


def _load_schema(kind: str) -> dict[str, Any]:
    mapping = {
        "feeder": "feeder.csv.json",
        "substation": "substation.csv.json",
        "der": "der.csv.json",
        "ami": "ami.csv.json",
        "gis": None,
        "scada": None,
        "connection": None,
    }
    name = mapping.get(kind)
    if not name:
        return {"required": [], "properties": {}}
    path = SCHEMAS / name
    if not path.exists():
        return {"required": [], "properties": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def inspect_upload(
    filename: str,
    content: bytes,
    dataset_kind: str,
    use_case: str,
    territory_bbox: tuple[float, float, float, float] | None = None,
) -> dict[str, Any]:
    lower = filename.lower()
    if lower.endswith(".csv"):
        table = _read_csv(content)
        geometry_rows = []
    elif lower.endswith(".geojson") or lower.endswith(".json"):
        table, geometry_rows = _read_geojson(content)
    elif lower.endswith(".gpkg"):
        return {
            "filename": filename,
            "datasetKind": dataset_kind,
            "issues": [
                {
                    "severity": "medium",
                    "title": "GeoPackage parser is a stub in V1",
                    "detail": "Upload accepted. Full GeoPackage inspection is not yet connected. Convert to GeoJSON or CSV for a complete score.",
                }
            ],
            "status": "not_fully_connected",
            "readiness": {"overall": 40, "completeness": 40, "schema": 40, "spatial": 40, "relationships": 40, "consistency": 40},
            "checklist": _checklist(dataset_kind, use_case, []),
        }
    else:
        raise ValueError("Supported uploads: CSV, GeoJSON, GeoPackage.")

    schema = _load_schema(dataset_kind)
    issues: list[dict[str, Any]] = []
    columns = table["columns"]
    rows = table["rows"]
    n = len(rows)

    expected = list((schema.get("properties") or {}).keys())
    required = list(schema.get("required") or [])
    unexpected = [c for c in columns if expected and c not in expected]
    missing = [c for c in expected if c not in columns]

    if missing:
        issues.append(
            {
                "severity": "high" if any(c in required for c in missing) else "medium",
                "title": "Schema gaps",
                "detail": f"Expected columns not found: {', '.join(missing) or '—'}.",
            }
        )
    if unexpected:
        issues.append(
            {
                "severity": "info",
                "title": "Unexpected columns",
                "detail": f"{', '.join(unexpected[:12])}{'…' if len(unexpected) > 12 else ''}",
            }
        )

    null_counts = {c: sum(1 for r in rows if r.get(c) in {None, "", "null", "NA"}) for c in columns}
    completeness_vals = [(n - null_counts[c]) / n for c in columns] if n and columns else [0]
    completeness = 100 * (sum(completeness_vals) / len(completeness_vals) if completeness_vals else 0)

    id_cols = [c for c in columns if c.endswith("_id") or c in {"nmi", "id", "asset_id"}]
    missing_ids = 0
    for c in id_cols:
        missing_ids += null_counts.get(c, 0)
    if missing_ids:
        issues.append({"severity": "high", "title": "Missing identifiers", "detail": f"{missing_ids} identifier cells are empty."})

    # duplicates
    dup = 0
    if id_cols:
        seen: dict[str, int] = {}
        for r in rows:
            key = "|".join(str(r.get(c) or "") for c in id_cols)
            if not key.strip("|"):
                continue
            seen[key] = seen.get(key, 0) + 1
        dup = sum(v - 1 for v in seen.values() if v > 1)
        if dup:
            issues.append({"severity": "medium", "title": "Duplicate records", "detail": f"{dup} extra rows share an identifier."})

    spatial_score = 80
    if geometry_rows:
        invalid = 0
        outside = 0
        for g in geometry_rows:
            if not g.get("ok"):
                invalid += 1
            coords = g.get("coords") or []
            for lon, lat in coords[:20]:
                if abs(lat) > 90 or abs(lon) > 180:
                    invalid += 1
                    issues.append(
                        {
                            "severity": "high",
                            "title": "Impossible coordinates",
                            "detail": f"Coordinate ({lon}, {lat}) is outside WGS84 bounds.",
                        }
                    )
                    break
                if territory_bbox:
                    minx, miny, maxx, maxy = territory_bbox
                    if not (minx - 0.2 <= lon <= maxx + 0.2 and miny - 0.2 <= lat <= maxy + 0.2):
                        outside += 1
                        break
        if invalid:
            issues.append({"severity": "high", "title": "Invalid geometries", "detail": f"{invalid} features failed basic geometry checks."})
            spatial_score -= min(40, invalid)
        if outside:
            issues.append(
                {
                    "severity": "medium",
                    "title": "Assets outside indicative territory",
                    "detail": f"{outside} features sit outside a padded Endeavour bounding box. Confirm CRS and network.",
                }
            )
            spatial_score -= min(25, outside // 2)
        issues.append(
            {
                "severity": "info",
                "title": "CRS assumption",
                "detail": "GeoJSON is treated as EPSG:4326 (WGS84) for web visualisation.",
            }
        )
    elif dataset_kind in {"gis", "substation", "der"}:
        lat = next((c for c in columns if "lat" in c.lower()), None)
        lon = next((c for c in columns if "lon" in c.lower() or "lng" in c.lower()), None)
        if not lat or not lon:
            issues.append({"severity": "medium", "title": "No geometry", "detail": "No latitude/longitude columns and no GeoJSON geometry."})
            spatial_score = 45
        else:
            spatial_score = 75

    rel_score = 88
    if dataset_kind == "feeder" and "zone_substation_id" in columns:
        missing_parent = sum(1 for r in rows if not r.get("zone_substation_id"))
        if missing_parent:
            issues.append(
                {
                    "severity": "high",
                    "title": "Broken feeder → substation relationship",
                    "detail": f"{missing_parent} feeder records do not reference a parent zone substation.",
                }
            )
            rel_score = max(20, 90 - missing_parent)
    if dataset_kind == "der" and "feeder_id" in columns:
        missing_feeder = sum(1 for r in rows if not r.get("feeder_id"))
        if missing_feeder:
            issues.append(
                {
                    "severity": "medium",
                    "title": "DER not associated with a feeder",
                    "detail": f"{missing_feeder} DER records have no feeder_id. Spatial association was not attempted on this file.",
                }
            )
            rel_score = max(30, 90 - missing_feeder // 2)

    consistency = 90
    for c in columns:
        cl = c.lower()
        if any(tok in cl for tok in ("kw", "kva", "capacity", "length", "customer")):
            neg = 0
            for r in rows:
                try:
                    if float(r.get(c) or 0) < 0:
                        neg += 1
                except ValueError:
                    pass
            if neg:
                issues.append({"severity": "high", "title": "Negative capacities", "detail": f"{neg} values in {c} are negative."})
                consistency -= min(30, neg)
        if "date" in cl or cl.endswith("_end") or "timestamp" in cl:
            bad = 0
            for r in rows:
                v = r.get(c)
                if not v:
                    continue
                if not _looks_like_date(str(v)):
                    bad += 1
            if bad:
                issues.append({"severity": "medium", "title": "Invalid dates", "detail": f"{bad} values in {c} are not ISO-like dates."})
                consistency -= min(20, bad // 3)

    schema_score = 100
    if required:
        present_req = sum(1 for c in required if c in columns)
        schema_score = 100 * present_req / len(required)
        schema_score -= min(15, len(unexpected))
        schema_score = max(0, schema_score)

    overall = round(
        0.25 * completeness
        + 0.2 * schema_score
        + 0.2 * max(0, spatial_score)
        + 0.2 * rel_score
        + 0.15 * max(0, consistency)
    )

    issues.sort(key=lambda i: {"high": 0, "medium": 1, "info": 2}.get(i["severity"], 3))
    detected_kinds = [dataset_kind]
    checklist = _checklist(dataset_kind, use_case, detected_kinds)

    return {
        "filename": filename,
        "datasetKind": dataset_kind,
        "rowCount": n,
        "columns": columns,
        "nullCounts": null_counts,
        "issues": issues,
        "readiness": {
            "overall": int(max(0, min(100, overall))),
            "completeness": int(completeness),
            "schema": int(max(0, schema_score)),
            "spatial": int(max(0, spatial_score)),
            "relationships": int(max(0, rel_score)),
            "consistency": int(max(0, consistency)),
        },
        "checklist": checklist,
        "syntheticNotice": "If this file came from data/demo, it is synthetic demonstration data.",
    }


def _checklist(dataset_kind: str, use_case: str, present: list[str]) -> dict[str, Any]:
    spec = USE_CASES.get(use_case, USE_CASES["flexible_exports"])
    kind_map = {
        "feeder": "feeder topology",
        "substation": "substation assets",
        "der": "DER register",
        "ami": "interval smart meter data",
        "gis": "GIS asset files",
        "scada": "voltage observations",
        "connection": "connection queue",
    }
    have = {kind_map.get(dataset_kind, dataset_kind)}
    available, missing, clarify = [], [], []
    for item in spec["needed"]:
        if item in have or any(item.startswith(h) for h in have):
            available.append(item)
        elif item in {"topology update metadata", "inverter export limits", "constraint signals"}:
            clarify.append(item)
        else:
            missing.append(item)
    next_step = "Upload a feeder extract and a DER register for the same depot so relationships can be tested."
    if dataset_kind == "feeder":
        next_step = "Add the parent zone-substation table and a DER register joined on feeder_id."
    if dataset_kind == "ami":
        next_step = "Confirm interval length, quality flags and whether reverse flow is signed."
    return {
        "useCase": spec["label"],
        "available": available,
        "missing": missing,
        "requiresClarification": clarify,
        "recommendedNextStep": next_step,
    }


def _read_csv(content: bytes) -> dict[str, Any]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    columns = reader.fieldnames or []
    rows = [{k: (v.strip() if isinstance(v, str) else v) for k, v in row.items()} for row in reader]
    return {"columns": list(columns), "rows": rows}


def _read_geojson(content: bytes) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    data = json.loads(content.decode("utf-8"))
    features = data.get("features") if isinstance(data, dict) else data
    if not isinstance(features, list):
        features = [data]
    rows = []
    geoms = []
    columns: list[str] = []
    for f in features:
        props = dict(f.get("properties") or {})
        geom = f.get("geometry") or {}
        ok = geom.get("type") in {"Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon"}
        coords = _flatten_coords(geom.get("coordinates"))
        geoms.append({"ok": ok and bool(coords), "coords": coords})
        for k in props:
            if k not in columns:
                columns.append(k)
        rows.append(props)
    return {"columns": columns, "rows": rows}, geoms


def _flatten_coords(c: Any) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    if c is None:
        return out
    if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
        if len(c) >= 2:
            out.append((float(c[0]), float(c[1])))
        return out
    if isinstance(c, (list, tuple)):
        for part in c:
            out.extend(_flatten_coords(part))
    return out


def _looks_like_date(v: str) -> bool:
    v = v.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%d/%m/%Y"):
        try:
            datetime.strptime(v[:19].replace("Z", ""), fmt.replace("Z", ""))
            return True
        except ValueError:
            continue
    if len(v) >= 10 and v[4] == "-" and v[7] == "-":
        return True
    return False
