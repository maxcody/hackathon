"""Master data import and read endpoints, against a throwaway database."""

import pytest

from app.config import settings

FILES = {
    "catalog_v2.csv": (
        "product_id,name,product_line,lifecycle,launch_date,weekly_plan_qty,"
        "day_one_qty,plants,std_cost_eur,valid_from\n"
        "FG-1,Game,GH,launch,2026-11-22,100,640,DC-HAM,11.9,2026-11-21\n"
        "FG-0,Old,GH,running,2013-09-17,50,,DC-HAM,7.8,2026-11-21\n"
    ),
    "parts.csv": (
        "component_id,description,category,uom,abc_class,critical,drawing_rev\n"
        "CMP-1,Card,Media,PC,A,Y,A\nCMP-2,Case,Print,PC,C,N,A\n"
    ),
    "structure/lines.csv": (
        "parent_id,child_id,qty_per,valid_from,valid_to\n"
        "FG-1,CMP-1,1,2024-01-01,9999-12-31\nFG-1,CMP-2,4,2024-01-01,9999-12-31\n"
    ),
    "ecn_nov30.csv": (
        "change_id,parent_id,child_id,action,qty_per_old,qty_per_new,rev_old,"
        "rev_new,use_up_old_rev,effective_from,reason\n"
        "ECN-1,FG-1,CMP-2,revision,4,4,A,B,Y,2026-11-21,fold changed\n"
    ),
    "part_changes_a.csv": (
        "component_id,field,old,new,changed_by\n"
        "CMP-2,drawing_rev,A,B,Sofia\nCMP-2,critical,N,Y,Mei\n"
        "CMP-1,colour,x,y,Nobody\nCMP-9,drawing_rev,A,B,Nobody\n"
    ),
    # Sorted after part_changes_a, so it is applied last
    "part_changes_b.csv": (
        "component_id,field,old,new,changed_by\nCMP-2,drawing_rev,B,C,Sofia\n"
    ),
    "unrelated.csv": "id,qty\n1,2\n",  # matches no kind and is ignored
}


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """Point DATA_DIR at a tiny master folder."""
    master = tmp_path / "soony" / "master"
    (master / "structure").mkdir(parents=True)  # files can live in any folder
    for name, content in FILES.items():
        (master / name).write_text(content)
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


async def test_import_applies_updates_and_serves_data(client, data_dir):
    summary = (await client.post("/master/import")).json()
    assert summary["products"] == 2 and summary["bom_lines"] == 2
    assert summary["skipped_updates"] == ["CMP-1.colour", "CMP-9.drawing_rev"]

    comp = (await client.get("/components/CMP-2")).json()
    assert comp["drawing_rev"] == "C" and comp["critical"] is True
    assert (await client.get("/components/CMP-1")).json()["drawing_rev"] == "A"
    assert [
        c["component_id"]
        for c in (await client.get("/components?category=Print")).json()
    ] == ["CMP-2"]

    product = (await client.get("/products/FG-1")).json()
    assert product["day_one_qty"] == 640
    assert [(b["child_id"], b["qty_per"]) for b in product["bom"]] == [
        ("CMP-1", 1),
        ("CMP-2", 4),
    ]
    assert (await client.get("/products/FG-0")).json()["day_one_qty"] is None
    assert len((await client.get("/products")).json()) == 2

    change = (await client.get("/bom-changes")).json()[0]
    assert change["use_up_old_rev"] is True and change["rev_new"] == "B"


async def test_import_without_delta_files(client, data_dir, tmp_path):
    master = tmp_path / "soony" / "master"
    for name in ("ecn_nov30.csv", "part_changes_a.csv", "part_changes_b.csv"):
        (master / name).unlink()
    summary = (await client.post("/master/import")).json()
    assert summary["bom_changes"] == 0 and summary["components"] == 2


async def test_import_twice_does_not_duplicate(client, data_dir):
    await client.post("/master/import")
    await client.post("/master/import")
    assert len((await client.get("/products/FG-1")).json()["bom"]) == 2


async def test_import_without_data_is_409(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    assert (await client.post("/master/import")).status_code == 409


async def test_missing_product_and_component_are_404(client):
    assert (await client.get("/products/nope")).status_code == 404
    assert (await client.get("/components/nope")).status_code == 404
