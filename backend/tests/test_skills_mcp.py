"""Tests for the skills MCP server."""

from scripts import skills_mcp
from scripts.skills_mcp import get_skill, list_skills, read_skill


def test_reads_front_matter_and_body(tmp_path) -> None:
    path = tmp_path / "SKILL.md"
    path.write_text("---\nname: demo\ndescription: Does a thing\n---\n\n# Steps\n1. Go")
    meta, body = read_skill(path)
    assert meta == {"name": "demo", "description": "Does a thing"}
    assert body.startswith("# Steps")


def test_lists_and_loads_skills(tmp_path, monkeypatch) -> None:
    folder = tmp_path / "demo"
    folder.mkdir()
    (folder / "SKILL.md").write_text("---\nname: demo\ndescription: Demo\n---\nDo it")
    monkeypatch.setattr(skills_mcp, "SKILLS_DIR", tmp_path)
    assert list_skills() == "- demo: Demo"
    assert get_skill("demo") == "Do it"
    assert get_skill("nope").startswith("Unknown skill 'nope'")


def test_risk_check_skill_is_installed() -> None:
    assert "risk-check" in skills_mcp.skills()
    assert "report_notification" in get_skill("risk-check")
