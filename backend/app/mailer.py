"""Send plain-text email for agents and the dashboard (SMTP, Apps Script or Brevo).

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
from typing import Literal

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
    # Comma-separated; defaults to the hackathon's supplier sandbox domain and GMX.
    email_allowed_domains: str = "suppliers.juliansibbing.de,gmx.de,gmx.net,gmx.com"
    # Brevo's HTTPS API, used instead of SMTP when set (works where SMTP is blocked)
    brevo_api_key: str | None = None
    # How mail goes out: "smtp" (Gmail, From stays SMTP_USER so replies come back),
    # "gmail_script" (same Gmail account via the Apps Script web app over HTTPS, for
    # networks that block SMTP) or "brevo". Empty: Brevo when BREVO_API_KEY is set.
    # Brevo rewrites a free-mail sender like @gmail.com to an @…brevosend.com address
    # that cannot receive replies.
    mail_transport: Literal["smtp", "gmail_script", "brevo"] | None = None
    # Received mail: the Apps Script web app in scripts/gmail_inbox.gs
    gmail_script_url: str | None = None
    gmail_script_token: str | None = None


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


def send_via_gmail_script(message: EmailMessage, settings: EmailSettings) -> str:
    """Send ``message`` from the Gmail account through the Apps Script web app.

    Args:
        message: The composed message.
        settings: Settings holding ``gmail_script_url`` and ``gmail_script_token``.

    Returns:
        Gmail's Message-ID.

    Raises:
        httpx.HTTPError: If the script is unreachable.
        MailError: If the script refuses the message.
    """

    def split(header: str) -> list[str]:
        return [a.strip() for a in (message[header] or "").split(",") if a.strip()]

    response = httpx.post(
        settings.gmail_script_url,
        json={
            "token": settings.gmail_script_token,
            "to": split("To"),
            "cc": split("Cc"),
            "subject": message["Subject"],
            "body": message.get_content(),
            "reply_to": message["Reply-To"] or "",
        },
        follow_redirects=True,  # Apps Script answers via a googleusercontent redirect
        timeout=60,
    )
    response.raise_for_status()
    try:
        result = response.json()
    except ValueError as error:
        raise MailError(
            "the Apps Script did not answer with JSON; deploy the new version of "
            "scripts/gmail_inbox.gs (it needs doPost)"
        ) from error
    if "error" in result:
        raise MailError(f"Apps Script: {result['error']}")
    return result.get("message_id") or message["Message-ID"]


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
    use_brevo = settings.mail_transport == "brevo" or (
        settings.mail_transport is None and bool(settings.brevo_api_key)
    )
    if not settings.smtp_user:
        raise MailError("set SMTP_USER")
    if use_brevo and not settings.brevo_api_key:
        raise MailError("MAIL_TRANSPORT=brevo needs BREVO_API_KEY")
    use_script = settings.mail_transport == "gmail_script"
    if use_script and not (settings.gmail_script_url and settings.gmail_script_token):
        raise MailError("MAIL_TRANSPORT=gmail_script needs GMAIL_SCRIPT_URL and _TOKEN")
    if not (use_brevo or use_script) and not settings.smtp_app_password:
        raise MailError("sending over SMTP needs SMTP_APP_PASSWORD")
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
        if use_brevo:
            message.replace_header("Message-ID", send_via_brevo(message, settings))
        elif use_script:
            sent_id = send_via_gmail_script(message, settings)
            message.replace_header("Message-ID", sent_id)
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
