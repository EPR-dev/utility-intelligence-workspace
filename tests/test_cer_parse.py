from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipelines.build_network_bundle import parse_cer_matrix


def test_cer_monthly_aggregates_2577():
    text = Path("data/raw/cer_solar_installs.csv").read_text(encoding="utf-8")
    parsed = parse_cer_matrix(text)
    rec = parsed["2577"]
    assert rec["Total"] > 1000
    assert rec.get("2023", 0) > 0
