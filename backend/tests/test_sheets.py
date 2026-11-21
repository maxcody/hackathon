"""Excel import and /sheets endpoints, against a throwaway database."""

import zipfile
from html import escape

import pytest

from app.config import settings


def make_xlsx(path, sheets: dict[str, dict[int, list[str]]]) -> None:
    """Write a minimal inline-string xlsx; ``sheets`` maps name -> {row: cells}."""
    names = "".join(
        f'<sheet name="{n}" sheetId="{i}"/>' for i, n in enumerate(sheets, 1)
    )
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", f"<workbook><sheets>{names}</sheets></workbook>")
        for i, rows in enumerate(sheets.values(), 1):
            body = ""
            for number, cells in rows.items():
                cs = "".join(
                    f'<c r="{chr(65 + c)}{number}"><is><t>{escape(v)}</t></is></c>'
                    for c, v in enumerate(cells)
                    if v
                )
                body += f'<row r="{number}">{cs}</row>'
            z.writestr(
                f"xl/worksheets/sheet{i}.xml",
                f"<worksheet><sheetData>{body}</sheetData></worksheet>",
            )


async def rows(client, kind: str) -> list[dict]:
    """Return the stored rows of one kind, in source and row order."""
    found = (await client.get("/sheet-rows")).json()
    return sorted(
        (r for r in found if r["kind"] == kind),
        key=lambda r: (r["source"], r["row_no"]),
    )


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """A data folder with oddly named workbooks."""
    (tmp_path / "soony" / "anywhere").mkdir(parents=True)
    make_xlsx(
        tmp_path / "soony" / "anywhere" / "status_final_v9.xlsx",
        {
            "Whatever": {
                1: ["Launch status · Saturday 13:00"],
                3: ["Edition", "Copies"],  # group header above the real one
                4: [
                    "Name",
                    "Product",
                    "Day-one demand",
                    "Packed",
                    "Still to pack",
                    "Rate per hour",
                ],
                5: ["Standard", "FG-STD", "640.000", "554.000", "86.000", "6000"],
                6: ["Collector's", "FG-CE", "72.000", "53.100", "18.900", "900"],
            },
            "Remarks": {1: ["Note"], 2: ["Collector's first."], 3: ["Rev C released."]},
            "Shifts": {
                1: ["Day", "Shift", "Hours", "Lines"],
                2: ["Saturday", "06:00", "16", "L1"],
                3: ["30", "No night shift."],  # stray line: no Hours
            },
            "Junk": {1: ["foo", "bar"], 2: ["1", "2"]},
        },
    )
    (tmp_path / "suppliers").mkdir()
    make_xlsx(
        tmp_path / "suppliers" / "prices.xlsx",
        {
            "P": {
                1: [
                    "Material",
                    "Description",
                    "Current price",
                    "New price",
                    "Currency",
                    "Valid from",
                ],
                2: ["PR-CC-0312", "Case", "1.38", "1.44", "CNY", "2025-06-24"],
                4: ["Reason: raw materials."],
            }
        },
    )
    (tmp_path / "suppliers" / "broken.xlsx").write_text("not a zip")
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


async def test_import_cleans_and_serves_rows(client, data_dir):
    summary = (await client.post("/import/sheets")).json()
    assert summary["rows"] == {"editions": 2, "notes": 2, "shifts": 1, "price_list": 1}
    assert sorted(summary["skipped_rows"]) == [
        "soony/anywhere/status_final_v9.xlsx:Shifts:3",
        "suppliers/prices.xlsx:P:4",
    ]
    assert sorted(summary["ignored_sheets"]) == [
        "soony/anywhere/status_final_v9.xlsx:Junk",
        "suppliers/broken.xlsx",
    ]

    editions = await rows(client, "editions")
    assert editions[0]["data"]["Packed"] == 554000  # "554.000" is German thousands
    assert editions[0]["data"]["Rate per hour"] == 6000
    assert editions[0]["title"] == "Launch status · Saturday 13:00"
    assert editions[1]["data"]["Still to pack"] == 18900

    price = (await rows(client, "price_list"))[0]["data"]
    assert price["Current price"] == 1.38 and price["Valid from"] == "2025-06-24"
    assert [r["data"]["Note"] for r in await rows(client, "notes")] == [
        "Collector's first.",
        "Rev C released.",
    ]


async def test_identifiers_stay_text(client, data_dir, tmp_path):
    make_xlsx(
        tmp_path / "suppliers" / "tracker.xlsx",
        {
            "T": {
                1: ["Shipment", "Container/AWB", "Supplier", "POs", "ETD", "ETA"],
                2: [
                    "S1",
                    "020-48113256",
                    "X",
                    "4500318738",
                    "2026-10-14",
                    "2026-11-19",
                ],
            }
        },
    )
    await client.post("/import/sheets")
    data = (await rows(client, "shipments"))[0]["data"]
    assert data["POs"] == "4500318738" and data["Container/AWB"] == "020-48113256"


async def test_import_twice_does_not_duplicate(client, data_dir):
    await client.post("/import/sheets")
    await client.post("/import/sheets")
    assert len(await rows(client, "editions")) == 2
