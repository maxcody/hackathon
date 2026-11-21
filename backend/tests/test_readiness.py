import pytest

from app.data import data_root
from app.readiness import parts_readiness, verdict

pytestmark = pytest.mark.skipif(
    not (data_root() / "soony").exists(), reason="Soony data folder not available"
)


def by_part() -> dict[str, dict]:
    return {p["part"]: p for p in parts_readiness()}


def test_game_cards_short_after_short_shipment():
    cards = by_part()["CMP-GAM-001"]
    assert cards["need"] == 153_200
    assert cards["stock"] == 118_400
    assert cards["inbound"] == 28_000  # 48,000 booked, only 28,000 flew
    assert cards["gap"] == 6_800
    assert cards["status"] == "short"


def test_cases_covered_by_port_stock():
    cases = by_part()["CMP-GAM-003"]
    assert cases["inbound"] == 350_000
    assert cases["status"] == "ok"


def test_magnets_not_reported_as_gap():
    assert "CMP-MAG-005" not in by_part()


def test_verdict_is_no_go():
    assert verdict(parts_readiness()) == "NO-GO"
