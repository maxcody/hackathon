"""Act on the solutions agents attach to notifications (``data.solutions``)."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.db import SessionDep
from app.mailer import MailError, deliver
from app.models import Notification
from app.schemas.notification import NotificationRead

router = APIRouter(prefix="/notifications", tags=["solutions"])


class SolutionEmailSend(BaseModel):
    """The email as the user reviewed it in the popup (possibly edited)."""

    to: list[str]
    cc: list[str] = []
    subject: str
    body: str
    approved_by: str | None = None


@router.post("/{notification_id}/solutions/{index}/send")
async def send_solution_email(
    notification_id: int, index: int, email: SolutionEmailSend, session: SessionDep
) -> NotificationRead:
    """Send a solution's email and record on the notification that it was sent.

    A solution that names an approver (PP-07) is only sent with ``approved_by``.
    """
    notification = await session.get(Notification, notification_id)
    solutions = list((notification.data if notification else {}).get("solutions", []))
    if notification is None or not 0 <= index < len(solutions):
        raise HTTPException(404, "Solution not found.")
    solution = solutions[index]
    if not solution.get("email"):
        raise HTTPException(400, "This solution has no email to send.")
    if solution.get("status") == "sent":
        raise HTTPException(409, "This email was already sent.")
    approver = (email.approved_by or "").strip()
    if solution.get("approval") and not approver:
        raise HTTPException(400, f"Approval required: {solution['approval']}.")
    try:
        message_id = await run_in_threadpool(
            deliver, email.to, email.subject, email.body, email.cc
        )
    except MailError as error:
        raise HTTPException(502, f"Email not sent: {error}") from error
    solutions[index] = {
        **solution,
        "status": "sent",
        "sent_at": datetime.now(UTC).isoformat(),
        "message_id": message_id,
        "approved_by": approver or None,
        "sent_email": email.model_dump(exclude={"approved_by"}),
    }
    notification.data = {**notification.data, "solutions": solutions}
    await session.commit()
    await session.refresh(notification)
    return NotificationRead.model_validate(notification)
