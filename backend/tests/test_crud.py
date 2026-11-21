"""CRUD for the imported tables and notifications, against a throwaway database."""

import pytest

PRODUCT = {
    "product_id": "FG-1",
    "name": "Game",
    "product_line": "GH",
    "lifecycle": "launch",
    "launch_date": "2026-11-22",
    "weekly_plan_qty": 100,
    "plants": "DC-HAM",
    "std_cost_eur": "11.90",
    "valid_from": "2026-11-21",
}
COMPONENT = {
    "component_id": "CMP-1",
    "description": "Card",
    "category": "Media",
    "uom": "PC",
    "abc_class": "A",
    "critical": True,
    "drawing_rev": "A",
}
BOM_LINE = {
    "parent_id": "FG-1",
    "child_id": "CMP-1",
    "qty_per": 1,
    "valid_from": "2024-01-01",
    "valid_to": "9999-12-31",
}
BOM_CHANGE = {
    "change_id": "ECN-1",
    "parent_id": "FG-1",
    "child_id": "CMP-1",
    "action": "revision",
    "qty_per_old": 1,
    "qty_per_new": 1,
    "rev_old": "A",
    "rev_new": "B",
    "use_up_old_rev": True,
    "effective_from": "2026-11-21",
    "reason": "fold changed",
}
SHEET_ROW = {
    "kind": "editions",
    "source": "a.xlsx",
    "sheet": "S",
    "row_no": 4,
    "data": {"Packed": 554000},
}
NOTIFICATION = {
    "attr": "quantity",
    "erp_val": "80000",
    "customer_val": "8000",
    "data": {"title": "WZ-1 short", "status": "open"},
}


async def seed(client):
    """Create the product and component the other tables point at."""
    assert (await client.post("/products", json=PRODUCT)).status_code == 201
    assert (await client.post("/components", json=COMPONENT)).status_code == 201


async def test_product_crud_and_bom_shows_in_product(client):
    await seed(client)
    line = (await client.post("/bom-lines", json=BOM_LINE)).json()
    product = (await client.get("/products/FG-1")).json()
    assert product["day_one_qty"] is None
    assert [b["child_id"] for b in product["bom"]] == ["CMP-1"]

    patched = await client.patch("/products/FG-1", json={"day_one_qty": 640})
    assert patched.json()["day_one_qty"] == 640 and patched.json()["name"] == "Game"
    assert len((await client.get("/products")).json()) == 1

    assert (await client.delete(f"/bom-lines/{line['id']}")).status_code == 204
    assert (await client.delete("/products/FG-1")).status_code == 204
    assert (await client.get("/products/FG-1")).status_code == 404


async def test_component_update_and_bom_change(client):
    await seed(client)
    r = await client.patch("/components/CMP-1", json={"drawing_rev": "C"})
    assert r.json()["drawing_rev"] == "C" and r.json()["critical"] is True
    created = await client.post("/bom-changes", json=BOM_CHANGE)
    assert created.status_code == 201 and created.json()["use_up_old_rev"] is True
    assert (await client.get("/bom-changes/ECN-1")).json()["rev_new"] == "B"


async def test_sheet_row_crud(client):
    row = (await client.post("/sheet-rows", json=SHEET_ROW)).json()
    assert row["data"] == {"Packed": 554000} and row["title"] is None
    updated = await client.patch(
        f"/sheet-rows/{row['id']}", json={"title": "Sat 13:00"}
    )
    assert updated.json()["title"] == "Sat 13:00"
    assert (await client.delete(f"/sheet-rows/{row['id']}")).status_code == 204
    assert (await client.get("/sheet-rows")).json() == []


async def test_notification_crud(client):
    created = await client.post("/notifications", json=NOTIFICATION)
    assert created.status_code == 201
    note = created.json()
    assert (note["attr"], note["erp_val"], note["customer_val"]) == (
        "quantity",
        "80000",
        "8000",
    )
    assert note["seen_at"]  # defaults to now

    url = f"/notifications/{note['id']}"
    data = {**NOTIFICATION["data"], "status": "acknowledged"}
    patched = (await client.patch(url, json={"data": data})).json()
    assert patched["data"]["status"] == "acknowledged"
    assert patched["erp_val"] == "80000"
    assert len((await client.get("/notifications")).json()) == 1
    assert (await client.delete(url)).status_code == 204
    assert (await client.get(url)).status_code == 404


async def test_duplicate_and_missing_reference_are_409(client):
    await seed(client)
    assert (await client.post("/products", json=PRODUCT)).status_code == 409
    bad = {**BOM_LINE, "child_id": "CMP-NOPE"}
    assert (await client.post("/bom-lines", json=bad)).status_code == 409
    # the session still works after the failed insert
    assert (await client.get("/products")).status_code == 200


async def test_delete_referenced_product_is_409(client):
    await seed(client)
    await client.post("/bom-lines", json=BOM_LINE)
    assert (await client.delete("/components/CMP-1")).status_code == 409
    assert (await client.get("/components/CMP-1")).status_code == 200


@pytest.mark.parametrize("path", ["/products/x", "/components/x", "/bom-changes/x"])
async def test_missing_string_keys_are_404(client, path):
    assert (await client.get(path)).status_code == 404
    assert (await client.patch(path, json={})).status_code == 404
    assert (await client.delete(path)).status_code == 404


@pytest.mark.parametrize(
    "path", ["/bom-lines/999", "/sheet-rows/999", "/notifications/999"]
)
async def test_missing_int_keys_are_404(client, path):
    assert (await client.get(path)).status_code == 404
    assert (await client.patch(path, json={})).status_code == 404
    assert (await client.delete(path)).status_code == 404


async def test_bad_body_is_422(client):
    assert (
        await client.post("/notifications", json={"erp_val": "1"})
    ).status_code == 422
