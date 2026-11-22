"""Ranking the suppliers that can deliver a part."""

from pathlib import Path

import pytest

from app import sourcing
from app.config import settings

PROFILE = (
    "supplier_id,name,category,qualification_status,contact_email,preferred_language\n"
)


def supplier(root: Path, folder: str, profile: str, components: str = "") -> None:
    """Write one supplier folder with a profile row and optional components."""
    path = root / "suppliers" / folder
    path.mkdir(parents=True)
    (path / "profile.csv").write_text(PROFILE + profile + "\n", encoding="utf-8")
    if components:
        header = "component_id,description,category,share,unit_price,currency,"
        header += "lead_time_days,moq,primary,note\n"
        (path / "components.csv").write_text(header + components + "\n", "utf-8")


@pytest.fixture
def data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    supplier(
        tmp_path,
        "SUP-1_Alpha",
        "SUP-1,Alpha,Media,qualified,a@sup.test,ko",
        'CMP-1,"Card, 128 GB",Media,0.7,9.8,USD,63,20000,Y,',
    )
    supplier(
        tmp_path,
        "SUP-2_Beta",
        "SUP-2,Beta,Media,conditional,b@sup.test,en",
        'CMP-1,"Card, 128 GB",Media,0.3,10.2,USD,28,5000,N,',
    )
    supplier(tmp_path, "SUP-3_Gamma", "SUP-3,Gamma,Media,qualified,c@sup.test,de")
    supplier(tmp_path, "SUP-4_Delta", "SUP-4,Delta,Boxes,qualified,d@sup.test,pl")
    (tmp_path / "suppliers/SUP-2_Beta/notices").mkdir()
    (tmp_path / "suppliers/SUP-2_Beta/notices/offer.pdf").write_text("x")
    return tmp_path


def test_primary_then_second_source_then_same_category(data: Path) -> None:
    ranked = sourcing.options("CMP-1")
    assert [(o.name, o.role) for o in ranked] == [
        ("Alpha", "primary"),
        ("Beta", "second_source"),
        ("Gamma", "same_category"),
    ]
    alpha, beta, gamma = ranked
    assert (
        alpha.share == 0.7 and alpha.lead_time_days == 63 and not alpha.needs_approval
    )
    assert beta.needs_approval and beta.notices == [
        "suppliers/SUP-2_Beta/notices/offer.pdf"
    ]
    assert gamma.needs_approval and gamma.share is None


def test_unknown_part_has_no_sources(data: Path) -> None:
    assert sourcing.options("CMP-404") == []
