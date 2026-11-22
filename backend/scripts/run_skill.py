"""Run one agent skill headless, e.g. on a schedule.

Example: ``python scripts/run_skill.py risk-check``.

Uses the same Codex setup as the dashboard chat (data folder, read-only sandbox,
portal/notifications/email/skills tools approved) in a fresh session, and prints
the agent's final reply. Run from ``backend/`` so ``.env`` is found.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.codex_agent import CodexError, run_turn  # noqa: E402


def main() -> int:
    """Run the named skill once and print the result."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill", help="skill name, e.g. risk-check")
    name = parser.parse_args().skill
    try:
        reply, _ = run_turn(f"Run the {name} skill.", None)
    except CodexError as error:
        print(f"Skill {name} failed: {error}", file=sys.stderr)
        return 1
    print(reply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
