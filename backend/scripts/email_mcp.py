"""MCP server that lets agents (Codex, Claude Code, ...) send email over SMTP.

Run it over stdio from an MCP client, e.g. in ``~/.codex/config.toml``::

    [mcp_servers.email]
    command = "<repo>/.venv/Scripts/python.exe"
    args = ["<repo>/backend/scripts/email_mcp.py"]

Settings come from ``backend/.env``: ``SMTP_USER`` and ``SMTP_APP_PASSWORD``
are required; ``SMTP_HOST``, ``SMTP_PORT`` and ``EMAIL_ALLOWED_DOMAINS`` are
optional. Recipients outside the allowed domains (plus the sender's own
address) are refused, and every sent message is appended to an audit log.
"""

import json
import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path

import truststore
from mcp.server import MCPServer
from pydantic_settings import BaseSettings, SettingsConfigDict

# Trust the OS certificate store (needed behind TLS-inspecting company proxies).
truststore.inject_into_ssl()

BACKEND = Path(__file__).resolve().parents[1]
SENT_LOG = BACKEND.parent / ".local_data" / "sent_emails.jsonl"


class EmailSettings(BaseSettings):
    """SMTP settings read from ``backend/.env`` or the environment."""

    model_config = SettingsConfigDict(env_file=BACKEND / ".env", extra="ignore")

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 465
    smtp_user: str | None = None
    smtp_app_password: str | None = None
    # Comma-separated; defaults to the hackathon's supplier sandbox domain.
    email_allowed_domains: str = "suppliers.juliansibbing.de"


def blocked_recipients(recipients: list[str], settings: EmailSettings) -> list[str]:
    """Return the recipients that are not allowed to receive mail.

    Args:
        recipients: Addresses the agent wants to send to.
        settings: SMTP settings holding the allowed domains and sender.

    Returns:
        Addresses outside the allowed domains, other than the sender itself.
    """
    domains = {
        d.strip().casefold() for d in settings.email_allowed_domains.split(",") if d
    }
    sender = (settings.smtp_user or "").casefold()
    return [
        r
        for r in recipients
        if r.casefold() != sender and r.rpartition("@")[2].casefold() not in domains
    ]


server = MCPServer(
    "email",
    instructions=(
        "Send plain-text email over SMTP from the team's own address "
        f"({EmailSettings().smtp_user or 'not configured'}); 'yourself' or 'us' "
        "means that address, which may always receive mail. Other recipients must "
        "be in the allowed domains. Write to suppliers in their preferred language "
        "and never change payment details or bank data by email."
    ),
)


@server.tool()
def sender_info() -> str:
    """Return the address mail is sent from and who may receive mail.

    Returns:
        The sender address (which may also receive mail, e.g. for a test) and
        the allowed recipient domains.
    """
    settings = EmailSettings()
    if not settings.smtp_user:
        return "No sender configured: SMTP_USER is not set."
    return (
        f"Sender: {settings.smtp_user} (may also be a recipient). "
        f"Allowed recipient domains: {settings.email_allowed_domains}"
    )


@server.tool()
def send_email(
    to: list[str],
    subject: str,
    body: str,
    cc: list[str] | None = None,
    reply_to: str | None = None,
) -> str:
    """Send a plain-text email from the team's own address and return its Message-ID.

    The sender address (see ``sender_info``) may always be a recipient, e.g. when
    the user asks you to email yourself or the team.

    Args:
        to: Recipient addresses.
        subject: Subject line.
        body: Plain-text message body.
        cc: Optional CC addresses.
        reply_to: Optional Reply-To address.

    Returns:
        A confirmation with the Message-ID, or the reason nothing was sent.
    """
    settings = EmailSettings()
    if not settings.smtp_user or not settings.smtp_app_password:
        return "Not sent: SMTP_USER and SMTP_APP_PASSWORD are not configured."
    cc = cc or []
    if not to:
        return "Not sent: no recipients."
    blocked = blocked_recipients([*to, *cc], settings)
    if blocked:
        return f"Not sent: recipients outside allowed domains: {', '.join(blocked)}"

    message = EmailMessage()
    message["From"] = settings.smtp_user
    message["To"] = ", ".join(to)
    if cc:
        message["Cc"] = ", ".join(cc)
    if reply_to:
        message["Reply-To"] = reply_to
    message["Subject"] = subject
    message["Message-ID"] = make_msgid()
    message.set_content(body)

    try:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=30) as s:
            s.login(settings.smtp_user, settings.smtp_app_password)
            s.send_message(message)
    except (smtplib.SMTPException, OSError) as error:
        return f"Not sent: SMTP error ({type(error).__name__}: {error})"

    SENT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with SENT_LOG.open("a", encoding="utf-8") as log:
        entry = {
            "sent_at": datetime.now(UTC).isoformat(),
            "message_id": message["Message-ID"],
            "to": to,
            "cc": cc,
            "subject": subject,
            "body": body,
        }
        log.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return f"Sent to {', '.join([*to, *cc])}. Message-ID: {message['Message-ID']}"


if __name__ == "__main__":
    server.run()
