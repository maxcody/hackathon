"""Shared fixtures."""

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
