"""MCP server that hands agents the repeatable skills in ``backend/agent_skills``.

Run it over stdio from an MCP client, e.g. in ``~/.codex/config.toml``::

    [mcp_servers.skills]
    command = "<repo>/.venv/Scripts/python.exe"
    args = ["<repo>/backend/scripts/skills_mcp.py"]

Each skill is a folder with a ``SKILL.md`` (Agent Skills format: YAML front
matter with ``name`` and ``description``, then the instructions). Adding a
folder adds a skill; no code change is needed.
"""

from pathlib import Path

from mcp.server import MCPServer

SKILLS_DIR = Path(__file__).resolve().parents[1] / "agent_skills"


def read_skill(path: Path) -> tuple[dict[str, str], str]:
    """Split a ``SKILL.md`` into its front matter fields and its body.

    Args:
        path: The ``SKILL.md`` file.

    Returns:
        The ``key: value`` pairs from the front matter, and the remaining text.
    """
    text = path.read_text(encoding="utf-8")
    meta: dict[str, str] = {}
    if text.startswith("---"):
        header, _, text = text[3:].partition("\n---")
        for line in header.splitlines():
            key, sep, value = line.partition(":")
            if sep:
                meta[key.strip()] = value.strip()
    return meta, text.lstrip("-\n")


def skills() -> dict[str, tuple[str, Path]]:
    """Return every skill by name, with its description and file."""
    found = {}
    for path in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        meta, _ = read_skill(path)
        found[meta.get("name", path.parent.name)] = (meta.get("description", ""), path)
    return found


server = MCPServer(
    "skills",
    instructions=(
        "Repeatable procedures for the Linewatch agents. When the user asks for a "
        "skill by name, or the task matches a skill's description (for example "
        "'run a risk check'), call get_skill and follow its steps exactly."
    ),
)


@server.tool()
def list_skills() -> str:
    """List the available skills with what each one does.

    Returns:
        One line per skill: its name and description.
    """
    found = skills()
    if not found:
        return "No skills installed."
    return "\n".join(
        f"- {name}: {description}" for name, (description, _) in found.items()
    )


@server.tool()
def get_skill(name: str) -> str:
    """Return a skill's full instructions.

    Args:
        name: The skill's name, e.g. ``risk-check``.

    Returns:
        The step-by-step instructions, or the list of skills if the name is unknown.
    """
    found = skills()
    if name not in found:
        return f"Unknown skill {name!r}. Available:\n{list_skills()}"
    return read_skill(found[name][1])[1]


if __name__ == "__main__":
    server.run()
