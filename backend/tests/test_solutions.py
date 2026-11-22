"""Sending a notification's solution email, against a throwaway database."""

import pytest

from app.routers import solutions as router
from scripts.notifications_mcp import Solution, merge_solutions

EMAIL = {"to": ["a@suppliers.example.com"], "subject": "Order", "body": "Hi"}


def notification(**solution: object) -> dict:
    """A notification with one email solution."""
    return {
        "attr": "quantity",
        "data": {
            "key": "stock_shortage:CMP-GAM-008",
            "solutions": [
                {"kind": "email", "title": "Order", "email": EMAIL, **solution}
            ],
        },
    }


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    """Record sends instead of emailing."""
    calls: list[tuple] = []
    monkeypatch.setattr(
        router, "deliver", lambda *args: calls.append(args) or "<id@test>"
    )
    return calls


async def test_send_records_the_sent_email(client, sent) -> None:
    note = (await client.post("/notifications", json=notification())).json()
    edited = {**EMAIL, "body": "Hi, edited"}
    response = await client.post(
        f"/notifications/{note['id']}/solutions/0/send", json=edited
    )
    assert response.status_code == 200
    solution = response.json()["data"]["solutions"][0]
    assert solution["status"] == "sent" and solution["message_id"] == "<id@test>"
    assert solution["sent_email"]["body"] == "Hi, edited"
    assert sent == [(EMAIL["to"], "Order", "Hi, edited", [])]
    again = await client.post(
        f"/notifications/{note['id']}/solutions/0/send", json=EMAIL
    )
    assert again.status_code == 409


async def test_approval_is_required_when_named(client, sent) -> None:
    body = notification(approval="Category Lead (air freight)")
    note = (await client.post("/notifications", json=body)).json()
    url = f"/notifications/{note['id']}/solutions/0/send"
    refused = await client.post(url, json=EMAIL)
    assert refused.status_code == 400 and "Category Lead" in refused.json()["detail"]
    assert sent == []
    accepted = await client.post(url, json={**EMAIL, "approved_by": "Maren Vogt"})
    assert accepted.json()["data"]["solutions"][0]["approved_by"] == "Maren Vogt"


async def test_unknown_solution_is_404(client, sent) -> None:
    note = (await client.post("/notifications", json=notification())).json()
    response = await client.post(
        f"/notifications/{note['id']}/solutions/5/send", json=EMAIL
    )
    assert response.status_code == 404


def test_rerun_keeps_sent_solutions() -> None:
    old = [
        {"title": "Order books", "status": "sent"},
        {"title": "Old idea", "status": "proposed"},
    ]
    new = [
        Solution(kind="email", title="Order books", description="again"),
        Solution(kind="internal", title="Book dock slot", description="d"),
    ]
    merged = merge_solutions(old, new)
    assert [(s["title"], s["status"]) for s in merged] == [
        ("Order books", "sent"),
        ("Book dock slot", "proposed"),
    ]
