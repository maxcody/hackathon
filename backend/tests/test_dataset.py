"""The Data tab's datasets and file access, against a small fake data folder."""

from pathlib import Path

import pytest

from app import dataset
from app.config import settings


@pytest.fixture
def data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A data folder with one supplier, one shipment and one notice."""
    files = {
        "soony/erp/open_shipments.csv": "shipment_id,supplier_id,eta\n"
        "S2,SUP-1,2026-11-25\nS1,SUP-1,2026-11-21\n",
        "suppliers/SUP-1_Acme/profile.csv": "supplier_id,name\nSUP-1,Acme\n",
        "suppliers/SUP-1_Acme/notices/Offer_2026-11-21.pdf": "%PDF",
        "suppliers/SUP-1_Acme/order_confirmations/OA1_4500000001.pdf": "%PDF",
        "soony/receiving/DC-HAM/20261118_WZ-261116-473.jpg": "JPG",
    }
    for rel, text in files.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text, encoding="utf-8")
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    return tmp_path


def test_shipments_sorted_with_linked_columns(data: Path) -> None:
    table = dataset.load("shipments")
    assert [r["shipment_id"] for r in table.rows] == ["S1", "S2"]
    assert table.rows[0]["supplier_id"] == "SUP-1"  # raw id, so links can filter
    kinds = {c.key: c.kind for c in table.columns}
    assert kinds == {
        "shipment_id": "shipment",
        "supplier_id": "supplier",
        "eta": "date",
        "before_launch": "flag",
    }


def test_lookups_name_ids_and_find_documents(data: Path) -> None:
    found = dataset.lookups()
    assert found.suppliers == {"SUP-1": "Acme"}
    assert found.documents["WZ-261116-473"] == [
        "soony/receiving/DC-HAM/20261118_WZ-261116-473.jpg"
    ]
    assert found.documents["4500000001"][0].endswith("OA1_4500000001.pdf")


def test_documents_and_file_guard(data: Path) -> None:
    [doc] = dataset.load("notices").rows
    assert doc["path"] == "suppliers/SUP-1_Acme/notices/Offer_2026-11-21.pdf"
    assert (doc["dated"], doc["type"], doc["supplier_id"]) == (
        "2026-11-21",
        "notice",
        "SUP-1",
    )
    assert dataset.resolve(doc["path"]).read_text() == "%PDF"
    for bad in ("../outside.txt", "suppliers/missing.pdf"):
        with pytest.raises(FileNotFoundError):
            dataset.resolve(bad)


def test_unknown_dataset(data: Path) -> None:
    with pytest.raises(KeyError):
        dataset.load("nope")
    assert [d.key for d in dataset.catalog()] == [
        "parts",
        "shipments",
        "purchase_orders",
        "receipts",
        "suppliers",
        "notices",
    ]
