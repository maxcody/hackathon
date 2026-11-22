"""Who can supply a part: listed sources first, then same-category suppliers.

Every supplier folder ``suppliers/<id>_<name>/`` has ``profile.csv`` (one row)
and ``components.csv`` (the parts it supplies, with ``share``, ``primary``,
``lead_time_days`` and ``moq``). Agents use the ranked options to find a
second source when the first supplier cannot deliver.
"""

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.data import data_root


@dataclass
class SupplierFolder:
    """One supplier's profile, its parts and its notices (offers, price lists)."""

    folder: Path
    profile: dict[str, str]
    components: list[dict[str, str]] = field(default_factory=list)
    notices: list[str] = field(default_factory=list)  # paths relative to data root


def supplier_folders() -> list[SupplierFolder]:
    """Read every supplier folder that has a profile."""
    root = data_root()
    found = []
    for folder in sorted((root / "suppliers").glob("*")):
        profile_path = folder / "profile.csv"
        if not profile_path.exists():
            continue
        with profile_path.open(encoding="utf-8-sig", newline="") as f:
            profile = next(csv.DictReader(f), None) or {}
        components = []
        if (folder / "components.csv").exists():
            with (folder / "components.csv").open(
                encoding="utf-8-sig", newline=""
            ) as f:
                components = list(csv.DictReader(f))
        notices = sorted(
            (p.relative_to(root).as_posix() for p in (folder / "notices").glob("*")),
            reverse=True,  # names carry the date: newest first
        )
        profile.setdefault("name", folder.name)
        found.append(SupplierFolder(folder, profile, components, notices))
    return found


class Source(BaseModel):
    """A supplier that can (or might) supply a part."""

    supplier_id: str
    name: str
    role: Literal["primary", "second_source", "same_category"]
    contact_name: str = ""
    contact_email: str = ""
    preferred_language: str = ""
    qualification_status: str = ""
    share: float | None = None
    unit_price: float | None = None
    currency: str = ""
    lead_time_days: int | None = None
    moq: int | None = None
    note: str = ""
    # Conditional or not yet qualified for this part: PP-07 approval (and a sample)
    needs_approval: bool = False
    notices: list[str] = []


def _number(value: str | None, kind: type = float) -> float | int | None:
    try:
        return kind(float(value)) if value not in (None, "") else None
    except ValueError:
        return None


def options(component_id: str) -> list[Source]:
    """Rank the suppliers for a part: primary, second sources, then same category.

    Args:
        component_id: e.g. ``CMP-GAM-001``.

    Returns:
        Listed sources by role and share, then suppliers of the same category
        that do not list the part (unqualified, so they need approval).
    """
    folders = supplier_folders()
    listed: list[Source] = []
    categories: set[str] = set()
    for s in folders:
        row = next((c for c in s.components if c["component_id"] == component_id), None)
        if row is None:
            continue
        categories.add(row.get("category") or s.profile.get("category", ""))
        conditional = s.profile.get("qualification_status", "") != "qualified"
        listed.append(
            Source(
                supplier_id=s.profile.get("supplier_id", ""),
                name=s.profile["name"],
                role="primary" if row.get("primary") == "Y" else "second_source",
                contact_name=s.profile.get("contact_name", ""),
                contact_email=s.profile.get("contact_email", ""),
                preferred_language=s.profile.get("preferred_language", ""),
                qualification_status=s.profile.get("qualification_status", ""),
                share=_number(row.get("share")),
                unit_price=_number(row.get("unit_price")),
                currency=row.get("currency", ""),
                lead_time_days=_number(row.get("lead_time_days"), int),
                moq=_number(row.get("moq"), int),
                note=row.get("note", ""),
                needs_approval=conditional,
                notices=s.notices,
            )
        )
    listed.sort(key=lambda o: (o.role != "primary", -(o.share or 0)))
    known = {o.supplier_id for o in listed}
    others = [
        Source(
            supplier_id=s.profile.get("supplier_id", ""),
            name=s.profile["name"],
            role="same_category",
            contact_name=s.profile.get("contact_name", ""),
            contact_email=s.profile.get("contact_email", ""),
            preferred_language=s.profile.get("preferred_language", ""),
            qualification_status=s.profile.get("qualification_status", ""),
            note="Does not supply this part yet: needs a sample and approval.",
            needs_approval=True,
            notices=s.notices,
        )
        for s in folders
        if s.profile.get("supplier_id") not in known
        and s.profile.get("category") in categories
    ]
    return listed + others
