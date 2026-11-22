"""Send plain-text email for agents and the dashboard (Brevo API or Gmail SMTP).

Settings come from ``backend/.env``: ``SMTP_USER`` (the sender) plus either
``BREVO_API_KEY`` (Brevo's HTTPS API, works where SMTP is blocked) or
``SMTP_APP_PASSWORD`` (Gmail SMTP); ``SMTP_HOST``, ``SMTP_PORT`` and
``EMAIL_ALLOWED_DOMAINS`` are optional. Recipients outside the allowed domains
(plus the sender's own address) are refused, and every sent message is appended
to an audit log.
"""

import json
import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND = Path(__file__).resolve().parents[1]
SENT_LOG = BACKEND.parent / ".local_data" / "sent_emails.jsonl"


class MailError(Exception):
    """Raised when an email is not allowed or could not be sent."""


class EmailSettings(BaseSettings):
    """Mail settings read from ``backend/.env`` or the environment."""

    model_config = SettingsConfigDict(env_file=BACKEND / ".env", extra="ignore")

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 465
    smtp_user: str | None = None
    smtp_app_password: str | None = None
    # Comma-separated; defaults to the hackathon's supplier sandbox domain.
    email_allowed_domains: str = "suppliers.juliansibbing.de"
    # Brevo's HTTPS API, used instead of SMTP when set (works where SMTP is blocked)
    brevo_api_key: str | None = None


def send_via_brevo(message: EmailMessage, settings: EmailSettings) -> str:
    """Send ``message`` through Brevo's transactional email API.

    Args:
        message: The composed message; From must be a sender verified in Brevo.
        settings: Settings holding ``brevo_api_key``.

    Returns:
        Brevo's Message-ID.

    Raises:
        httpx.HTTPError: If Brevo is unreachable or rejects the message.
    """
    payload = {
        "sender": {"email": message["From"]},
        "to": [{"email": a.strip()} for a in message["To"].split(",")],
        "subject": message["Subject"],
        "textContent": message.get_content(),
    }
    if message["Cc"]:
        payload["cc"] = [{"email": a.strip()} for a in message["Cc"].split(",")]
    if message["Reply-To"]:
        payload["replyTo"] = {"email": message["Reply-To"]}
    response = httpx.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={"api-key": settings.brevo_api_key},
        json=payload,
        timeout=30,
    )
    if response.is_error:
        raise httpx.HTTPStatusError(
            f"Brevo {response.status_code}: {response.text[:300]}",
            request=response.request,
            response=response,
        )
    return response.json().get("messageId", message["Message-ID"])


def blocked_recipients(recipients: list[str], settings: EmailSettings) -> list[str]:
    """Return the recipients that are not allowed to receive mail.

    Args:
        recipients: Addresses someone wants to send to.
        settings: Settings holding the allowed domains and sender.

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


def deliver(
    to: list[str],
    subject: str,
    body: str,
    cc: list[str] | None = None,
    reply_to: str | None = None,
    settings: EmailSettings | None = None,
) -> str:
    """Send a plain-text email from the team's address and log it.

    Args:
        to: Recipient addresses.
        subject: Subject line.
        body: Plain-text message body.
        cc: Optional CC addresses.
        reply_to: Optional Reply-To address.
        settings: Mail settings; read from the environment when omitted.

    Returns:
        The Message-ID.

    Raises:
        MailError: If mail is not configured, a recipient is not allowed, or
            sending failed.
    """
    settings = settings or EmailSettings()
    if not settings.smtp_user or not (
        settings.brevo_api_key or settings.smtp_app_password
    ):
        raise MailError("set SMTP_USER and BREVO_API_KEY (or SMTP_APP_PASSWORD)")
    cc = cc or []
    if not to:
        raise MailError("no recipients")
    blocked = blocked_recipients([*to, *cc], settings)
    if blocked:
        raise MailError(f"recipients outside allowed domains: {', '.join(blocked)}")

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
        if settings.brevo_api_key:
            message.replace_header("Message-ID", send_via_brevo(message, settings))
        else:
            with smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port, timeout=30
            ) as s:
                s.login(settings.smtp_user, settings.smtp_app_password)
                s.send_message(message)
    except (smtplib.SMTPException, httpx.HTTPError, OSError) as error:
        raise MailError(f"{type(error).__name__}: {error}") from error

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
    return message["Message-ID"]
