"""Building an issue's email thread from sent solutions, replies and agent links."""

from app.mail_analysis import MailAnalysis
from app.routers.inbox import MailMessage
from app.routers.threads import thread_of


def mail(direction: str, message_id: str, at: str, **extra: object) -> MailMessage:
    """A mailbox message with only the fields threads look at."""
    return MailMessage(
        direction=direction,
        message_id=message_id,
        at=at,
        sender="x@sup.test",
        to=["y@sup.test"],
        subject="S",
        body="B",
        **extra,
    )


def test_thread_follows_replies_and_agent_links() -> None:
    data = {
        "key": "shortage:CMP-1",
        "solutions": [{"status": "sent", "message_id": "<a>"}],
        "followups": [{"message_id": "<c>"}],
    }
    messages = [
        mail("in", "<d>", "2026-11-22T04", in_reply_to="<b>"),  # reply to a reply
        mail("in", "<b>", "2026-11-22T02", in_reply_to="<a>"),
        mail("out", "<c>", "2026-11-22T03"),
        mail(
            "in",
            "<e>",
            "2026-11-22T05",
            analysis=MailAnalysis(
                message_id="<e>", notification_keys=["shortage:CMP-1"]
            ),
        ),
        mail("out", "<a>", "2026-11-22T01"),
        mail("in", "<a>", "2026-11-22T01"),  # sent to ourselves: listed twice
        mail("in", "<z>", "2026-11-22T06"),  # unrelated
    ]
    thread = thread_of(data, messages)
    assert [m.message_id for m in thread] == ["<a>", "<b>", "<c>", "<d>", "<e>"]
    assert thread[0].direction == "out"


def test_issue_without_emails_has_no_thread() -> None:
    assert thread_of({"key": "k"}, [mail("in", "<z>", "t")]) == []
