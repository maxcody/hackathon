"""Email triage: each received email gets one agent analysis."""

from pathlib import Path

import pytest

from app import mail_analysis, mail_triage
from app.codex_agent import CodexError
from app.mail_analysis import MailAnalysis
from app.routers.inbox import Mailbox, MailMessage


def message(direction: str, message_id: str, **extra: str) -> MailMessage:
    """A mailbox message with filler fields."""
    return MailMessage(
        direction=direction,
        message_id=message_id,
        at="2026-11-22T10:00",
        sender="s@sup",
        to=["me@x"],
        subject=f"Subject {message_id}",
        body="Body",
        **extra,
    )


@pytest.fixture
def box(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """A mailbox with one sent mail and two replies; record agent prompts."""
    monkeypatch.setattr(mail_analysis, "STORE", tmp_path / "analyses.json")
    messages = [
        message("in", "<r2>"),
        message("in", "<r1>", in_reply_to="<s>"),
        message("out", "<s>"),
    ]
    monkeypatch.setattr(
        mail_triage,
        "mailbox",
        lambda: Mailbox(
            messages=messages,
            sender="me@x",
            status_source=None,
            incoming_configured=True,
        ),
    )
    prompts: list[str] = []

    def agent(prompt: str, thread: str | None) -> tuple[str, str]:
        prompts.append(prompt)
        message_id = prompt.split("Message-ID: ")[1].split("\n")[0]
        if message_id == "<r1>":  # this agent records its analysis
            mail_analysis.save(MailAnalysis(message_id=message_id, summary="ok"))
        return "done", "thread"

    monkeypatch.setattr(mail_triage, "run_turn", agent)
    return prompts


def test_each_received_mail_is_analyzed_once(box: list[str]) -> None:
    assert mail_triage.triage_once() == 2
    assert "<r1>" in box[0] and "It replies to this email we sent" in box[0]
    analyses = mail_analysis.load()
    assert analyses["<r1>"].status == "done"
    assert analyses["<r2>"].status == "failed"  # agent did not record anything
    assert mail_triage.triage_once() == 0  # nothing new, no agent run
    assert len(box) == 2


def test_reanalyze_and_agent_errors(
    box: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    mail_triage.triage_once()
    assert mail_analysis.delete("<r2>")

    def broken(prompt: str, thread: str | None) -> tuple[str, str]:
        raise CodexError("Codex took too long to answer.")

    monkeypatch.setattr(mail_triage, "run_turn", broken)
    assert mail_triage.triage_once() == 1
    failed = mail_analysis.load()["<r2>"]
    assert failed.status == "failed" and "too long" in failed.error


def test_interrupted_run_is_retried(box: list[str]) -> None:
    mail_analysis.save(MailAnalysis(message_id="<r1>", status="running"))
    mail_analysis.save(MailAnalysis(message_id="<r2>", summary="done before"))
    assert mail_triage.triage_once() == 1
    assert mail_analysis.load()["<r1>"].status == "done"
