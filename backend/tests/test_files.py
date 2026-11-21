"""CRUD tests for /files, run against a throwaway Postgres database."""

BODY = {"path": "soony/a.png", "sha256": "a" * 64, "size_bytes": 10}


async def test_create_then_get_and_list(client):
    created = await client.post("/files", json=BODY)
    assert created.status_code == 201
    file_id = created.json()["id"]
    assert created.json()["status"] == "pending"

    detail = (await client.get(f"/files/{file_id}")).json()
    assert detail["path"] == BODY["path"] and detail["extracted"] is None
    assert [f["id"] for f in (await client.get("/files")).json()] == [file_id]


async def test_list_filters_by_status(client):
    file_id = (await client.post("/files", json=BODY)).json()["id"]
    await client.patch(f"/files/{file_id}", json={"status": "failed"})
    assert len((await client.get("/files?status=failed")).json()) == 1
    assert (await client.get("/files?status=processed")).json() == []


async def test_duplicate_path_is_409(client):
    await client.post("/files", json=BODY)
    assert (await client.post("/files", json=BODY)).status_code == 409


async def test_create_validates_sha256(client):
    bad = {**BODY, "sha256": "short"}
    assert (await client.post("/files", json=bad)).status_code == 422


async def test_update_status_and_error(client):
    file_id = (await client.post("/files", json=BODY)).json()["id"]
    r = await client.patch(
        f"/files/{file_id}", json={"status": "failed", "error": "boom"}
    )
    assert r.json()["status"] == "failed" and r.json()["error"] == "boom"
    bad = await client.patch(f"/files/{file_id}", json={"status": "nope"})
    assert bad.status_code == 422


async def test_delete(client):
    file_id = (await client.post("/files", json=BODY)).json()["id"]
    assert (await client.delete(f"/files/{file_id}")).status_code == 204
    assert (await client.get(f"/files/{file_id}")).status_code == 404


async def test_missing_file_is_404(client):
    assert (await client.get("/files/999")).status_code == 404
    assert (await client.patch("/files/999", json={})).status_code == 404
    assert (await client.delete("/files/999")).status_code == 404
