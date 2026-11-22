"""Mailer: MAIL_TRANSPORT picks Gmail SMTP or Brevo."""

from pathlib import Path

import pytest

from app import mailer
from app.mailer import EmailSettings, MailError


@pytest.fixture
def sent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record which transport sent each mail, without touching the network."""
    monkeypatch.setattr(mailer, "SENT_LOG", tmp_path / "sent.jsonl")
    used: list[str] = []
    monkeypatch.setattr(
        mailer,
        "send_via_brevo",
        lambda message, settings: used.append("brevo") or "<b>",
    )

    class FakeSMTP:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def __enter__(self) -> "FakeSMTP":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def login(self, user: str, password: str) -> None:
            pass

        def send_message(self, message: object) -> None:
            used.append("smtp")

    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", FakeSMTP)
    return used


def settings(**overrides: object) -> EmailSettings:
    """Mail settings with both transports configured, plus overrides."""
    values = {
        "smtp_user": "me@gmail.com",
        "smtp_app_password": "pw",
        "brevo_api_key": "k",
        "email_allowed_domains": "sup.test",
    }
    return EmailSettings(_env_file=None, **{**values, **overrides})


def test_brevo_is_used_by_default_when_its_key_is_set(sent: list[str]) -> None:
    mailer.deliver(["a@sup.test"], "S", "B", settings=settings())
    assert sent == ["brevo"]


def test_smtp_transport_keeps_the_gmail_sender(sent: list[str]) -> None:
    mailer.deliver(["a@sup.test"], "S", "B", settings=settings(mail_transport="smtp"))
    assert sent == ["smtp"]


def test_transport_without_its_credentials_is_refused(sent: list[str]) -> None:
    with pytest.raises(MailError, match="SMTP_APP_PASSWORD"):
        mailer.deliver(
            ["a@sup.test"],
            "S",
            "B",
            settings=settings(mail_transport="smtp", smtp_app_password=None),
        )
    with pytest.raises(MailError, match="BREVO_API_KEY"):
        mailer.deliver(
            ["a@sup.test"],
            "S",
            "B",
            settings=settings(mail_transport="brevo", brevo_api_key=None),
        )
    assert sent == []


def test_gmail_script_transport_posts_to_the_apps_script(
    sent: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    posted: list[dict] = []

    class Answer:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {"message_id": "<gmail-1>"}

    monkeypatch.setattr(
        mailer.httpx, "post", lambda url, json, **kw: posted.append(json) or Answer()
    )
    message_id = mailer.deliver(
        ["a@sup.test"],
        "S",
        "B",
        cc=["c@sup.test"],
        settings=settings(
            mail_transport="gmail_script",
            gmail_script_url="https://script.test",
            gmail_script_token="t",
        ),
    )
    assert message_id == "<gmail-1>" and sent == []
    assert posted[0]["to"] == ["a@sup.test"] and posted[0]["cc"] == ["c@sup.test"]
    assert posted[0]["token"] == "t" and posted[0]["body"].strip() == "B"
