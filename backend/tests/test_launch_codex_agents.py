"""Check Codex task parsing and launch isolation."""

from argparse import ArgumentTypeError
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.launch_codex_agents import parse_task, run_agent


@pytest.mark.parametrize("value", ["../escape=prompt", "agent=  ", "no-prompt"])
def test_rejects_invalid_tasks(value: str) -> None:
    """Reject empty prompts and names that could escape the output directory."""
    with pytest.raises(ArgumentTypeError, match="NAME=PROMPT"):
        parse_task(value)


@pytest.mark.parametrize("write", [False, True])
def test_sandbox_and_artifacts(tmp_path: Path, write: bool) -> None:
    """Run each agent with a bounded subprocess and private artifact paths."""
    output = tmp_path / "reviewer"
    with patch("scripts.launch_codex_agents.subprocess.run") as run:
        run.return_value.returncode = 0
        assert run_agent("codex", "Review the tests", output, None, write, 30) == 0
    command = run.call_args.args[0]
    assert ("--worktree" in command) is write
    assert command[command.index("--sandbox") + 1] == (
        "workspace-write" if write else "read-only"
    )
    assert run.call_args.kwargs["input"] == b"Review the tests"
    assert run.call_args.kwargs["timeout"] == 30
    assert (output / "events.jsonl").exists()
    assert (output / "stderr.log").exists()
