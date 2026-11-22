"""Inbox: sent mail from the audit log with Brevo delivery status."""

import json
from pathlib import Path

import httpx
import pytest

from app.mailer import EmailSettings
from app.routers import inbox

EVENTS = [
    {"messageId": "<a>", "event": "requests", "date": "t1"},
    {"messageId": "<a>", "event": "delivered", "date": "t2"},
    {"messageId": "<a>", "event": "requests", "date": "t3"},  # retry, not a downgrade
    {"messageId": "<b>", "event": "hardBounces", "date": "t1"},
    {"messageId": "<b>", "event": "delivered", "date": "t2"},  # error stays
]


@pytest.fixture
def setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A sent log with two mails and a fake Brevo events API."""
    log = tmp_path / "sent.jsonl"
    rows = [
        {
            "sent_at": "2026-11-21T10:00",
            "message_id": "<a>",
            "to": ["x@y"],
            "subject": "A",
            "body": "1",
        },
        {
            "sent_at": "2026-11-21T11:00",
            "message_id": "<b>",
            "to": ["x@y"],
            "subject": "B",
            "body": "2",
        },
    ]
    log.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    monkeypatch.setattr(inbox, "SENT_LOG", log)
    monkeypatch.setattr(
        inbox,
        "EmailSettings",
        lambda: EmailSettings(_env_file=None, smtp_user="me@x", brevo_api_key="k"),
    )
    request = httpx.Request("GET", "https://api.brevo.com")
    monkeypatch.setattr(
        inbox.httpx,
        "get",
        lambda *a, **k: httpx.Response(200, json={"events": EVENTS}, request=request),
    )


def test_newest_first_with_status(setup: None) -> None:
    box = inbox.mailbox()
    assert [m.subject for m in box.messages] == ["B", "A"]
    status = {m.subject: m.status for m in box.messages}
    assert status == {"A": "delivered", "B": "hardBounces"}
    assert box.status_source == "brevo" and box.sender == "me@x"


def test_received_mail_is_merged_and_errors_are_reported(
    setup: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    received = {
        "message_id": "<r>",
        "in_reply_to": "<a>",
        "at": "2026-11-21T12:00",
        "sender": "Supplier <s@sup>",
        "to": ["me@x"],
        "subject": "Re: A",
        "body": "ok",
    }
    request = httpx.Request("GET", "https://script.google.com")

    def fake_get(url: str, **kwargs: object) -> httpx.Response:
        if "brevo" in url:
            return httpx.Response(200, json={"events": EVENTS}, request=request)
        payload = (
            {"messages": [received]}
            if kwargs["params"]["token"] == "t"
            else {"error": "forbidden"}
        )
        return httpx.Response(200, json=payload, request=request)

    monkeypatch.setattr(inbox.httpx, "get", fake_get)
    settings = {
        "smtp_user": "me@x",
        "brevo_api_key": "k",
        "gmail_script_url": "https://script",
    }
    monkeypatch.setattr(
        inbox,
        "EmailSettings",
        lambda: EmailSettings(_env_file=None, gmail_script_token="t", **settings),
    )
    box = inbox.mailbox()
    assert [m.subject for m in box.messages] == ["Re: A", "B", "A"]
    assert box.messages[0].direction == "in" and box.messages[0].in_reply_to == "<a>"
    monkeypatch.setattr(
        inbox,
        "EmailSettings",
        lambda: EmailSettings(_env_file=None, gmail_script_token="wrong", **settings),
    )
    box = inbox.mailbox()
    assert box.incoming_error and "forbidden" in box.incoming_error
    assert len(box.messages) == 2  # sent mail still shown
