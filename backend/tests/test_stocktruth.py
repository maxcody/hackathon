import pytest

from app.data import data_root
from app.llm import to_int
from app.stocktruth import find_mismatches, stock_adjustments

needs_data = pytest.mark.skipif(
    not (data_root() / "soony").exists(), reason="Soony data folder not available"
)
ART_BOOK_SCAN = "soony/receiving/DC-HAM/20261118_WZ-261116-473.jpg"


def read(qty: int) -> dict:
    return {"lines": [{"part": "CMP-GAM-008", "final_qty": qty}]}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (8000, 8000),
        ("8 000", 8000),
        ("80.000", 80000),
        ("125.000", 125000),
        ("12,5", 12),
        (None, None),
        ("n/a", None),
    ],
)
def test_to_int_handles_separators(raw, expected):
    assert to_int(raw) == expected


@needs_data
def test_art_book_receipt_booked_ten_times_too_high():
    (mismatch,) = find_mismatches({ART_BOOK_SCAN: read(8000)})
    assert (mismatch.part, mismatch.booked, mismatch.actual) == (
        "CMP-GAM-008",
        80000,
        8000,
    )
    assert stock_adjustments([mismatch]) == {"CMP-GAM-008": -72000}


@needs_data
def test_matching_scan_is_not_a_mismatch():
    assert find_mismatches({ART_BOOK_SCAN: read(80000)}) == []


@needs_data
def test_two_rows_of_one_part_are_compared_by_total():
    # DN-261016-359 lists 5.000 and 6.000 of CMP-GAM-002; two receipts booked both
    scan = {
        "lines": [
            {"part": "CMP-GAM-002", "final_qty": 5000},
            {"part": "CMP-GAM-002", "final_qty": 6000},
        ]
    }
    assert (
        find_mismatches({"soony/receiving/DC-HAM/20261021_DN-261016-359.png": scan})
        == []
    )
