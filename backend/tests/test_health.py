from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_docs_available():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/openapi.json")
    assert r.status_code == 200
