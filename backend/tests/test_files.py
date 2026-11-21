"""CRUD tests for /files, run against a throwaway Postgres database."""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.db import get_session
from app.main import app
from app.models import Base

TEST_DB = "hackathon_test"
BODY = {"path": "soony/a.png", "sha256": "a" * 64, "size_bytes": 10}


@pytest.fixture
async def client():
    """Client wired to a fresh ``hackathon_test`` database, dropped afterwards."""
    url = make_url(settings.database_url)
    admin = create_async_engine(url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    try:
        async with admin.connect() as conn:
            await conn.execute(text(f"DROP DATABASE IF EXISTS {TEST_DB}"))
            await conn.execute(text(f"CREATE DATABASE {TEST_DB}"))
    except OSError:
        pytest.skip("Postgres is not running")
    engine = create_async_engine(url.set(database=TEST_DB), poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def override():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()
    async with admin.connect() as conn:
        await conn.execute(text(f"DROP DATABASE {TEST_DB}"))
    await admin.dispose()


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
