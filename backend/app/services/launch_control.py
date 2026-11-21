"""Coordinate specialized agents for Soony's launch readiness."""

from datetime import UTC, datetime

STANDARD_REQUIRED = 640_000
STANDARD_PACKED = 512_000
COLLECTOR_REQUIRED = 72_000
COLLECTOR_PACKED = 46_800


def build_launch_brief() -> dict[str, object]:
    """Reconcile the verified kickoff baseline and produce a prioritized brief.

    Returns:
        A launch status with evidence, risks, and human-reviewable actions.
    """
    editions = [
        {
            "edition": "Standard",
            "required": STANDARD_REQUIRED,
            "packed": STANDARD_PACKED,
            "remaining": STANDARD_REQUIRED - STANDARD_PACKED,
            "completion_pct": round(STANDARD_PACKED / STANDARD_REQUIRED * 100, 1),
        },
        {
            "edition": "Collector's Edition",
            "required": COLLECTOR_REQUIRED,
            "packed": COLLECTOR_PACKED,
            "remaining": COLLECTOR_REQUIRED - COLLECTOR_PACKED,
            "completion_pct": round(COLLECTOR_PACKED / COLLECTOR_REQUIRED * 100, 1),
        },
    ]
    total_required = sum(int(item["required"]) for item in editions)
    total_packed = sum(int(item["packed"]) for item in editions)
    total_remaining = total_required - total_packed

    risks = [
        {
            "severity": "critical",
            "title": "Collector's Edition is the largest proportional gap",
            "detail": "25,200 units remain (35% of the day-one requirement).",
            "evidence": "Kickoff baseline: 46,800 of 72,000 packed.",
            "owner": "Unassigned — supplier mapping not yet verified",
            "action": "Confirm the responsible supplier, line capacity, and final pack-out time.",
        },
        {
            "severity": "high",
            "title": "Standard edition still has 128,000 units to pack",
            "detail": "20% of the day-one requirement remains unpacked.",
            "evidence": "Kickoff baseline: 512,000 of 640,000 packed.",
            "owner": "Unassigned — supplier mapping not yet verified",
            "action": "Request a confirmed hourly completion plan and flag any material constraint.",
        },
        {
            "severity": "high",
            "title": "No alternate distribution center is available",
            "detail": "All day-one quantities depend on the Hamburg distribution center.",
            "evidence": "Case brief: 1 distribution center, no plan B site.",
            "owner": "Logistics lead",
            "action": "Verify dock slots, truck capacity, and latest loading cutoff for Sunday 20:00.",
        },
    ]

    return {
        "customer": "Soony",
        "release": "Grand Heist 6",
        "deadline": "Sunday 22 November, 20:00",
        "status": "AT_RISK",
        "generated_at": datetime.now(UTC).isoformat(),
        "summary": {
            "required": total_required,
            "packed": total_packed,
            "remaining": total_remaining,
            "completion_pct": round(total_packed / total_required * 100, 1),
        },
        "editions": editions,
        "risks": risks,
        "agents": [
            {
                "name": "Baseline Reconciler",
                "status": "complete",
                "result": "Reconciled packed quantities against day-one demand.",
            },
            {
                "name": "Shortage Prioritizer",
                "status": "complete",
                "result": "Ranked Collector's Edition first by proportional shortage.",
            },
            {
                "name": "Supplier Chaser",
                "status": "needs_review",
                "result": "Prepared supplier questions; supplier ownership must be verified from Soony records.",
            },
        ],
        "sources": [
            {
                "name": "Hack League case kickoff brief",
                "facts": [
                    "640,000 Standard and 72,000 Collector's Editions required on day one.",
                    "512,000 Standard and 46,800 Collector's Editions packed at kickoff.",
                    "One Hamburg distribution center; no alternate site.",
                ],
            }
        ],
        "limitations": [
            "Supplier assignments, purchase orders, goods receipts, and shipment confirmations have not been connected yet.",
            "No supplier email is sent automatically. Review and approve any follow-up before sending.",
        ],
    }


def build_supplier_draft(edition: str) -> dict[str, str]:
    """Create a supplier follow-up based on verified edition shortfalls.

    Args:
        edition: Edition label from the kickoff baseline.

    Returns:
        A draft message with explicit quantities and requested confirmations.

    Raises:
        ValueError: If the edition is not in the kickoff baseline.
    """
    quantities = {
        "Standard": STANDARD_REQUIRED - STANDARD_PACKED,
        "Collector's Edition": COLLECTOR_REQUIRED - COLLECTOR_PACKED,
    }
    if edition not in quantities:
        raise ValueError("Choose Standard or Collector's Edition.")

    remaining = quantities[edition]
    return {
        "to": "Supplier contact required — verify against Soony supplier master",
        "subject": f"URGENT: Grand Heist 6 {edition} pack-out confirmation",
        "body": (
            f"Hello,\n\n"
            f"Soony's kickoff baseline shows {remaining:,} {edition} units still to pack "
            f"for the Grand Heist 6 day-one requirement. Please confirm:\n"
            "1. Current packed quantity and remaining quantity at your site.\n"
            "2. Hour-by-hour pack-out plan and the time the final units will be ready.\n"
            "3. Any material, quality, staffing, or equipment issue that could delay completion.\n"
            "4. Dispatch readiness and the earliest truck handover time to Hamburg.\n\n"
            "The release deadline is Sunday 22 November at 20:00. If any commitment is at risk, "
            "please state the shortfall and latest recovery option now.\n\n"
            "Please do not treat this message as a confirmed order change.\n"
        ),
        "status": "draft_for_human_review",
        "evidence": f"Kickoff baseline; {remaining:,} {edition} units remain unpacked.",
    }
