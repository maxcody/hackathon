"""Email drafting: the agent prompt and reading its draft back."""

from pathlib import Path

import pytest

from app import email_drafting
from app.email_drafting import DraftRequest, build_prompt, parse_draft
from app.routers.inbox import MailMessage
from app.sourcing import SupplierFolder

ISSUE = {
    "title": "Short",
    "headline": "6,800 game cards short",
    "facts": [{"label": "Missing", "value": "6,800"}],
    "solutions": [{"title": "Expedite", "description": "Split the PO"}],
}


@pytest.fixture(autouse=True)
def supplier(monkeypatch: pytest.MonkeyPatch) -> None:
    """One Korean supplier in the data folder."""
    profile = {
        "name": "Hwaseong Memory",
        "contact_name": "Seo-yeon Kim",
        "contact_email": "sy.kim@sup.test",
        "preferred_language": "ko",
    }
    monkeypatch.setattr(
        email_drafting,
        "supplier_folders",
        lambda: [SupplierFolder(folder=Path("x"), profile=profile)],
    )


def reply_from_supplier() -> MailMessage:
    return MailMessage(
        direction="in",
        message_id="<r>",
        at="2026-11-22T10:00",
        sender="Seo-yeon Kim <sy.kim@sup.test>",
        to=["me@x"],
        subject="Re: PO 1",
        body="We can ship 3,000 tomorrow.",
    )


def test_new_draft_prompt_has_issue_thread_and_language() -> None:
    prompt = build_prompt(
        ISSUE, [reply_from_supplier()], DraftRequest(to="SY.KIM@sup.test")
    )
    assert "6,800 game cards short" in prompt and "Missing: 6,800" in prompt
    assert "We can ship 3,000 tomorrow." in prompt
    assert "Hwaseong Memory" in prompt and "(ko)" in prompt
    assert "Feedback" not in prompt  # nothing to refine


def test_refine_prompt_carries_the_draft_and_feedback() -> None:
    request = DraftRequest(
        to="sy.kim@sup.test",
        subject="PO 1",
        body="Dear Seo-yeon,\n...",
        feedback="shorter",
    )
    prompt = build_prompt(ISSUE, [], request)
    assert "Current draft:\nSubject: PO 1\nDear Seo-yeon," in prompt
    assert "Feedback from the user: shorter" in prompt
    assert "No emails have been exchanged" in prompt


def test_fresh_draft_can_carry_a_brief() -> None:
    request = DraftRequest(to="sy.kim@sup.test", feedback="Ask for a sorting plan")
    prompt = build_prompt(ISSUE, [], request)
    assert "What this email must achieve: Ask for a sorting plan" in prompt
    assert "Current draft" not in prompt


def test_parse_reads_a_fenced_block() -> None:
    reply = (
        "Here it is:\n```email-draft\n"
        '{"subject": "PO 1", "body": "Dear A,\\n\\nHi"}\n```'
    )
    draft = parse_draft(reply)
    assert draft.subject == "PO 1" and draft.body == "Dear A,\n\nHi"


def test_parse_falls_back_to_bare_json_and_old_subject() -> None:
    draft = parse_draft('{"body": "Text"}', fallback_subject="Re: PO 1")
    assert draft.subject == "Re: PO 1" and draft.body == "Text"


def test_parse_rejects_replies_without_a_draft() -> None:
    with pytest.raises(ValueError):
        parse_draft("Sorry, I cannot help with that.")
    with pytest.raises(ValueError):
        parse_draft('{"subject": "x", "body": ""}')
