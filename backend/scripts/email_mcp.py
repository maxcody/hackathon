"""MCP server that lets agents (Codex, Claude Code, ...) send email.

Run it over stdio from an MCP client, e.g. in ``~/.codex/config.toml``::

    [mcp_servers.email]
    command = "<repo>/.venv/Scripts/python.exe"
    args = ["<repo>/backend/scripts/email_mcp.py"]

Sending, settings and the recipient guard live in ``app.mailer`` (shared with
the dashboard's send button); see its docstring for the ``.env`` settings.
"""

import sys
from pathlib import Path

import truststore
from mcp.server import MCPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mailer import (  # noqa: E402
    EmailSettings,
    MailError,
    blocked_recipients,
    deliver,
)

# Trust the OS certificate store (needed behind TLS-inspecting company proxies).
truststore.inject_into_ssl()

__all__ = ["EmailSettings", "blocked_recipients", "send_email", "sender_info"]

server = MCPServer(
    "email",
    instructions=(
        "Send plain-text email from the team's own address "
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
    cc = cc or []
    try:
        message_id = deliver(to, subject, body, cc, reply_to)
    except MailError as error:
        return f"Not sent: {error}"
    return f"Sent to {', '.join([*to, *cc])}. Message-ID: {message_id}"


if __name__ == "__main__":
    server.run()
