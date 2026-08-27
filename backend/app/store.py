from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from . import CONFIG_DIR, PROCESSED


@lru_cache(maxsize=8)
def load_network_config(network_id: str) -> dict[str, Any]:
    path = CONFIG_DIR / f"{network_id}.json"
    if not path.exists():
        raise FileNotFoundError(network_id)
    return json.loads(path.read_text(encoding="utf-8"))


def list_networks() -> list[dict[str, Any]]:
    out = []
    for path in sorted(CONFIG_DIR.glob("*.json")):
        cfg = json.loads(path.read_text(encoding="utf-8"))
        processed = PROCESSED / cfg["id"] / "bundle.json"
        out.append(
            {
                "id": cfg["id"],
                "name": cfg["name"],
                "jurisdiction": cfg.get("jurisdiction"),
                "bundleReady": processed.exists(),
            }
        )
    return out


@lru_cache(maxsize=4)
def load_bundle(network_id: str) -> dict[str, Any]:
    path = PROCESSED / network_id / "bundle.json"
    if not path.exists():
        raise FileNotFoundError(f"No processed bundle for {network_id}. Run pipelines/build_network_bundle.py")
    return json.loads(path.read_text(encoding="utf-8"))


def layer_path(network_id: str, name: str) -> Path:
    allowed = {
        "territory",
        "postcodes",
        "zone_substations",
        "transmission_substations",
        "hv_switching",
        "industrial",
        "ev_charging",
        "commercial",
    }
    if name not in allowed:
        raise KeyError(name)
    path = PROCESSED / network_id / f"{name}.geojson"
    if not path.exists():
        raise FileNotFoundError(name)
    return path


def postcode_record(bundle: dict[str, Any], postcode: str) -> dict[str, Any] | None:
    for p in bundle.get("postcodes", []):
        if p["postcode"] == postcode:
            return p
    return None
