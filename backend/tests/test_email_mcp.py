"""Tests for the email MCP server's recipient guard."""

from scripts.email_mcp import EmailSettings, blocked_recipients, send_email, sender_info


def make_settings(**overrides: str) -> EmailSettings:
    """Build settings that ignore the local .env file."""
    values = {
        "smtp_user": "team@gmail.com",
        "smtp_app_password": "secret",
        "email_allowed_domains": "suppliers.example.com",
        **overrides,
    }
    return EmailSettings(_env_file=None, **values)


def test_allows_supplier_domain_and_sender() -> None:
    settings = make_settings()
    recipients = ["a@Suppliers.Example.com", "TEAM@gmail.com"]
    assert blocked_recipients(recipients, settings) == []


def test_blocks_other_domains() -> None:
    settings = make_settings()
    recipients = ["a@suppliers.example.com", "boss@soony.de"]
    assert blocked_recipients(recipients, settings) == ["boss@soony.de"]


def test_send_refuses_blocked_recipient_without_connecting(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_USER", "team@gmail.com")
    monkeypatch.setenv("SMTP_APP_PASSWORD", "secret")
    monkeypatch.setenv("EMAIL_ALLOWED_DOMAINS", "suppliers.example.com")
    reply = send_email(to=["someone@elsewhere.com"], subject="Hi", body="Test")
    assert reply.startswith("Not sent: recipients outside allowed domains")


def test_sender_info_names_sender_and_domains(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_USER", "team@gmail.com")
    monkeypatch.setenv("EMAIL_ALLOWED_DOMAINS", "suppliers.example.com")
    reply = sender_info()
    assert "team@gmail.com" in reply and "suppliers.example.com" in reply
