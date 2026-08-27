from pathlib import Path

from backend.app.readiness import inspect_upload

DEMO = Path(__file__).resolve().parents[1] / "data" / "demo"


def test_feeder_upload_flags_missing_parent():
    raw = (DEMO / "synthetic_feeders.csv").read_bytes()
    result = inspect_upload("synthetic_feeders.csv", raw, "feeder", "flexible_exports")
    titles = [i["title"] for i in result["issues"]]
    assert "Broken feeder → substation relationship" in titles
    assert result["readiness"]["overall"] < 95
    assert "Negative capacities" in titles
