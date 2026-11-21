"""Coordinate specialized agents for Soony's launch readiness."""

import re
from datetime import UTC, datetime
from typing import Any

from app.services.data_intake import Document

STANDARD_REQUIRED = 640_000
STANDARD_PACKED = 512_000
COLLECTOR_REQUIRED = 72_000
COLLECTOR_PACKED = 46_800


def build_launch_brief(documents: list[Document] | None = None) -> dict[str, object]:
    """Reconcile the verified kickoff baseline and produce a prioritized brief.

    Returns:
        A launch status with evidence, risks, and human-reviewable actions.
    """
    documents = documents or []
    current_status = _latest_edition_status(documents)
    standard_required, standard_packed, standard_rate = current_status.get(
        "standard", (STANDARD_REQUIRED, STANDARD_PACKED, 0)
    )
    collector_required, collector_packed, collector_rate = current_status.get(
        "collector", (COLLECTOR_REQUIRED, COLLECTOR_PACKED, 0)
    )
    editions = [
        _edition_summary("Standard", standard_required, standard_packed, standard_rate),
        _edition_summary(
            "Collector's Edition", collector_required, collector_packed, collector_rate
        ),
    ]
    total_required = sum(int(item["required"]) for item in editions)
    total_packed = sum(int(item["packed"]) for item in editions)
    total_remaining = total_required - total_packed

    collector_remaining = int(editions[1]["remaining"])
    standard_remaining = int(editions[0]["remaining"])
    status_source = next(
        (document.path for document in documents if document.path.endswith("launch_status.xlsx")),
        None,
    )
    risks = [
        {
            "severity": "high",
            "title": "Collector's Edition pre-orders must be protected first",
            "detail": f"{quantity(collector_remaining)} pre-ordered copies remain to pack.",
            "evidence": (
                f"{status_source} · latest pack-out status"
                if status_source
                else f"Kickoff baseline: {quantity(COLLECTOR_PACKED)} of {quantity(COLLECTOR_REQUIRED)} packed."
            ),
            "owner": "Mei Lin · Buyer, Collector's Items",
            "action": "Prioritize Collector's Edition when assigning shared parts; confirm its cell's remaining run time.",
        },
        {
            "severity": "high",
            "title": "Standard edition still has 128,000 units to pack",
            "detail": f"{quantity(standard_remaining)} units remain to pack.",
            "evidence": (
                f"{status_source} · latest pack-out status"
                if status_source
                else f"Kickoff baseline: {quantity(STANDARD_PACKED)} of {quantity(STANDARD_REQUIRED)} packed."
            ),
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
    risks[1]["title"] = f"Standard edition still has {quantity(standard_remaining)} units to pack"
    risks.extend(_component_change_risks(documents, collector_remaining))

    policy_text = "\n".join(
        document.text
        for document in documents
        if document.path.endswith("memo_launch_priorities.docx")
    ).casefold()
    operating_priorities = []
    if policy_text:
        memo_path = "soony/context/memo_launch_priorities.docx"
        if "collector's edition first" in policy_text or "collector's pre-orders first" in policy_text:
            operating_priorities.append(
                {
                    "title": "Collector's Edition first",
                    "detail": "Give shared parts to the Collector's cell before Standard; all Collector's copies are pre-ordered.",
                    "source": memo_path,
                }
            )
        if "quality & compliance" in policy_text or "quality and compliance" in policy_text:
            operating_priorities.append(
                {
                    "title": "Only quality-released parts can ship",
                    "detail": "Quality & Compliance has the final release decision for every part.",
                    "source": memo_path,
                }
            )
        if "above the policy limits" in policy_text:
            operating_priorities.append(
                {
                    "title": "Escalate high-cost expedite decisions",
                    "detail": "Send expedite options above policy limits to the CPO with the cost and copies recovered.",
                    "source": memo_path,
                }
            )

    sources = [
        {
            "name": "Hack League case kickoff brief",
            "facts": [
                "640,000 Standard and 72,000 Collector's Editions required on day one.",
                "512,000 Standard and 46,800 Collector's Editions packed at kickoff.",
                "One Hamburg distribution center; no alternate site.",
            ],
        }
    ]
    if status_source:
        sources.append(
            {
                "name": status_source,
                "facts": [
                    f"Latest status: {quantity(standard_packed)} of {quantity(standard_required)} Standard packed.",
                    f"Latest status: {quantity(collector_packed)} of {quantity(collector_required)} Collector's packed.",
                ],
            }
        )

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
                "result": (
                    f"Used {status_source} for the latest edition quantities."
                    if status_source
                    else "Reconciled kickoff packed quantities against day-one demand."
                ),
            },
            {
                "name": "Shortage Prioritizer",
                "status": "complete",
                "result": "Prioritized the pre-ordered Collector's Edition per the latest CPO direction.",
            },
            {
                "name": "Supplier Chaser",
                "status": "needs_review",
                "result": "Prepared supplier questions; supplier ownership must be verified from Soony records.",
            },
        ],
        "sources": sources,
        "operating_priorities": operating_priorities,
        "limitations": [
            "Supplier assignments, purchase orders, goods receipts, and shipment confirmations have not been connected yet.",
            "No supplier email is sent automatically. Review and approve any follow-up before sending.",
        ],
    }


def build_supplier_draft(
    edition: str, documents: list[Document] | None = None
) -> dict[str, str]:
    """Create a supplier follow-up based on verified edition shortfalls.

    Args:
        edition: Edition label from the kickoff baseline.

    Returns:
        A draft message with explicit quantities and requested confirmations.

    Raises:
        ValueError: If the edition is not in the kickoff baseline.
    """
    current_status = _latest_edition_status(documents or [])
    quantities = {
        "Standard": int(
            current_status.get("standard", (STANDARD_REQUIRED, STANDARD_PACKED, 0))[0]
            - current_status.get("standard", (STANDARD_REQUIRED, STANDARD_PACKED, 0))[1]
        ),
        "Collector's Edition": int(
            current_status.get("collector", (COLLECTOR_REQUIRED, COLLECTOR_PACKED, 0))[0]
            - current_status.get("collector", (COLLECTOR_REQUIRED, COLLECTOR_PACKED, 0))[1]
        ),
    }
    if edition not in quantities:
        raise ValueError("Choose Standard or Collector's Edition.")

    remaining = quantities[edition]
    return {
        "to": "Supplier contact required — verify against Soony supplier master",
        "subject": f"URGENT: Grand Heist 6 {edition} pack-out confirmation",
        "body": (
            f"Hello,\n\n"
            f"Soony's latest launch status shows {remaining:,} {edition} units still to pack "
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
        "evidence": f"Latest launch status; {remaining:,} {edition} units remain unpacked.",
    }


def _edition_summary(
    name: str, required: int, packed: int, rate_per_hour: int
) -> dict[str, Any]:
    """Summarize progress and estimated pack-out time for one edition."""
    remaining = max(0, required - packed)
    return {
        "edition": name,
        "required": required,
        "packed": packed,
        "remaining": remaining,
        "completion_pct": round(packed / required * 100, 1) if required else 0,
        "hours_needed": round(remaining / rate_per_hour, 1) if rate_per_hour else None,
    }


def _latest_edition_status(
    documents: list[Document],
) -> dict[str, tuple[int, int, int]]:
    """Read edition quantities from the dedicated latest-status workbook."""
    status = next(
        (document for document in documents if document.path.endswith("launch_status.xlsx")),
        None,
    )
    if not status:
        return {}
    output: dict[str, tuple[int, int, int]] = {}
    for row in status.rows:
        values = {_normalize_key(key): value for key, value in row.items()}
        name = str(values.get("name", values.get("edition", ""))).casefold()
        edition_key = "collector" if "collector" in name else "standard" if "standard" in name else ""
        required = _quantity(values.get("dayonedemand", values.get("required")))
        packed = _quantity(values.get("packed"))
        rate = _quantity(values.get("rateperhour")) or 0
        if edition_key and required is not None and packed is not None:
            output[edition_key] = (required, packed, rate)
    return output


def _component_change_risks(
    documents: list[Document], collector_remaining: int
) -> list[dict[str, str]]:
    """Surface component shortages and unreleased revision changes."""
    risks: list[dict[str, str]] = []
    bom = next((doc for doc in documents if doc.path.endswith("/master/bom.csv")), None)
    stock = next(
        (doc for doc in documents if doc.path.endswith("/erp/stock_snapshot.csv")),
        None,
    )
    if bom and stock:
        magnets_per_edition = 0
        for row in bom.rows:
            values = {_normalize_key(key): value for key, value in row.items()}
            if values.get("parentid") == "FG-GH6-CE" and values.get("childid") == "CMP-MAG-005":
                magnets_per_edition = _quantity(values.get("qtyper")) or 0
                break
        magnet_stock = 0
        for row in stock.rows:
            values = {_normalize_key(key): value for key, value in row.items()}
            if values.get("materialid") == "CMP-MAG-005" and values.get("site") == "DC-HAM":
                magnet_stock += _quantity(values.get("quantity")) or 0
        magnet_need = collector_remaining * magnets_per_edition
        if magnets_per_edition and magnet_need > magnet_stock:
            risks.append(
                {
                    "severity": "critical",
                    "title": "Collector's Edition is short of lid magnets",
                    "detail": f"{quantity(magnet_need)} magnets are needed for the remaining {quantity(collector_remaining)} Collector's copies; {quantity(magnet_stock)} are in the latest stock snapshot.",
                    "evidence": "soony/master/bom.csv · FG-GH6-CE uses 4 × CMP-MAG-005; soony/erp/stock_snapshot.csv · DC-HAM stock",
                    "owner": "Mei Lin · Buyer, Collector's Items; escalate to Dr. Maren Vogt",
                    "action": "Escalate now: confirm physical stock, locate an approved source, and get Quality & Compliance release before packing.",
                }
            )

    revision_file = next(
        (doc for doc in documents if doc.path.endswith("bom_delta_2026-11-21.csv")),
        None,
    )
    if revision_file:
        for index, row in enumerate(revision_file.rows, start=2):
            values = {_normalize_key(key): value for key, value in row.items()}
            if (
                values.get("childid") == "CMP-GAM-004"
                and str(values.get("action", "")).casefold() == "revision"
                and str(values.get("useupoldrev", "")).casefold() not in {"y", "yes", "true"}
            ):
                old_rev = values.get("revold", "?")
                new_rev = values.get("revnew", "?")
                risks.append(
                    {
                        "severity": "high",
                        "title": "Old sleeve artwork must not enter launch pack-out",
                        "detail": f"CMP-GAM-004 changed from revision {old_rev} to {new_rev}; the change notice says old-revision stock cannot be used.",
                        "evidence": f"{revision_file.path} · row {index}; soony/context/memo_launch_priorities.docx",
                        "owner": "Paul Winter · Print & Packaging; Clara Weiss · Quality & Compliance",
                        "action": "Confirm all sleeves allocated to Grand Heist 6 are released revision C before packing; quarantine older revision stock.",
                    }
                )
                break
    return risks


def _normalize_key(value: Any) -> str:
    """Normalize a workbook label for tolerant field matching."""
    return re.sub(r"[^a-z0-9]", "", str(value).casefold())


def _quantity(value: Any) -> int | None:
    """Convert workbook quantities including European thousands separators."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip().replace("\u00a0", "").replace(" ", "")
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", text):
        text = text.replace(".", "")
    elif re.fullmatch(r"\d{1,3}(,\d{3})+", text):
        text = text.replace(",", "")
    else:
        text = text.replace(",", "")
    try:
        return int(float(text))
    except ValueError:
        return None


def quantity(value: int) -> str:
    """Format a quantity with thousands separators."""
    return f"{value:,}"
