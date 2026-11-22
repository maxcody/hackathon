"""Launch readiness computed from a small fake data folder."""

from pathlib import Path

import pytest

from app.config import settings
from app.readiness import compute

FILES = {
    "soony/master/products.csv": "product_id,name,launch_date,day_one_qty\n"
    "STD,Standard,2026-11-22,100\nOLD,Old game,2013-09-17,\n",
    "soony/master/bom.csv": "parent_id,child_id,qty_per,valid_from,valid_to\n"
    "STD,CARD,1,2024-01-01,9999-12-31\nSTD,BOX,2,2024-01-01,9999-12-31\n"
    "STD,MAG,4,2024-01-01,9999-12-31\nSTD,GONE,1,2020-01-01,2021-01-01\n",
    "soony/master/components.csv": "component_id,description,critical\n"
    "CARD,Game card,Y\nBOX,Box,N\nMAG,Magnet,N\n",
    "soony/erp/packout_log.csv": "date,site,product_id,line,units_packed\n"
    "2026-11-19,DC-HAM,STD,L1,60\n2026-11-19,DC-XX,STD,L1,999\n",
    "soony/erp/stock_snapshot.csv": "snapshot_date,site,material_id,quantity\n"
    "2026-11-19,DC-HAM,CARD,1\n2026-11-20,DC-HAM,CARD,30\n2026-11-20,DC-HAM,BOX,100\n",
    "soony/erp/goods_receipts.csv": "gr_date,plant,material_id,qty_received\n"
    "2026-11-21,DC-HAM,CARD,5\n2026-11-20,DC-HAM,CARD,500\n",
    "soony/erp/open_shipments.csv": "shipment_id,mode,supplier_id,material_ids,"
    "dest_site,eta,status\nS1,air,SUP-1,CARD|BOX,DC-HAM,2026-11-22,booked\n"
    "S2,sea,SUP-1,CARD,DC-HAM,2026-12-01,in_transit\n",
    "suppliers/SUP-1_Acme/profile.csv": "supplier_id,name\nSUP-1,Acme\n",
    "suppliers/SUP-1_Acme/components.csv": "component_id,note\nCARD,\n"
    "MAG,fitted by supplier into BOX; not stocked\n",
}


@pytest.fixture
def data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Write the fake data folder and point DATA_DIR at it."""
    for rel, text in FILES.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text, encoding="utf-8")
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    return tmp_path


def test_editions_count_only_the_site(data: Path) -> None:
    result = compute()
    assert result.launch_date == "2026-11-22" and result.snapshot_date == "2026-11-20"
    [std] = result.editions
    assert (std.packed, std.remaining) == (60, 40)


def test_part_coverage(data: Path) -> None:
    parts = {p.component_id: p for p in compute().parts}
    card = parts["CARD"]
    # need 40; latest snapshot 30 plus 5 received after it (not the 500 before)
    assert (card.need, card.stock, card.received_since, card.balance) == (40, 30, 5, -5)
    assert [s.shipment_id for s in card.inbound] == ["S1"]  # S2 arrives after launch
    assert card.suppliers == ["Acme"] and card.critical
    assert parts["BOX"].balance == 20  # 100 - 40 x 2
    assert parts["MAG"].fitted_into == "BOX"
    assert "GONE" not in parts  # BOM line no longer valid
