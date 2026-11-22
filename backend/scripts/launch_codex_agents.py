"""Launch independent Codex CLI sessions and collect their results."""

import argparse
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from tempfile import mkdtemp

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / ".local_data" / "codex-runs"


def parse_task(value: str) -> tuple[str, str]:
    """Read a named task from a NAME=PROMPT command-line argument.

    Args:
        value: The supplied argument.

    Returns:
        The agent name and prompt.

    Raises:
        argparse.ArgumentTypeError: The name or prompt is invalid.
    """
    name, _, prompt = value.partition("=")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}", name) or not prompt.strip():
        raise argparse.ArgumentTypeError("Use NAME=PROMPT with a nonempty prompt.")
    return name, prompt


def run_agent(
    executable: str,
    prompt: str,
    output: Path,
    model: str | None,
    write: bool,
    timeout: int,
) -> int:
    """Run one sandboxed Codex session with its own logs and final reply.

    Args:
        executable: Path to the Codex executable.
        prompt: Instructions sent to Codex on standard input.
        output: Directory for this session's artifacts.
        model: Optional model override.
        write: Whether to allow edits in a separate managed worktree.
        timeout: Maximum runtime in seconds.

    Returns:
        The Codex process exit status, or 124 after a timeout.
    """
    output.mkdir()
    command = [
        executable,
        "exec",
        "--cd",
        str(ROOT),
        "--sandbox",
        "workspace-write" if write else "read-only",
        "--json",
        "--output-last-message",
        str(output / "reply.md"),
    ]
    if write:
        command.append("--worktree")
    if model:
        command.extend(["--model", model])
    with (output / "events.jsonl").open("wb") as events, (output / "stderr.log").open(
        "wb"
    ) as errors:
        try:
            return subprocess.run(
                [*command, "-"],
                input=prompt.encode("utf-8"),
                stdout=events,
                stderr=errors,
                timeout=timeout,
                check=False,
            ).returncode
        except subprocess.TimeoutExpired:
            errors.write(b"\nCodex session timed out.\n")
            return 124


def main() -> None:
    """Validate a batch of tasks, launch it, and report per-agent status."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", action="append", type=parse_task, required=True)
    parser.add_argument("--parallel", type=int, default=2)
    parser.add_argument("--timeout", type=int, default=900, help="Seconds per task.")
    parser.add_argument("--model", help="Override the model for this batch.")
    parser.add_argument("--write", action="store_true", help="Use isolated worktrees.")
    args = parser.parse_args()
    if args.parallel < 1 or args.timeout < 1:
        parser.error("--parallel and --timeout must be positive")
    names = [name.casefold() for name, _ in args.task]
    if len(set(names)) != len(names):
        parser.error("Each agent needs a unique name")
    executable = shutil.which("codex")
    if executable is None:
        parser.error("Install and sign in to the Codex CLI first")

    RUNS.mkdir(parents=True, exist_ok=True)
    output = Path(mkdtemp(prefix="run-", dir=RUNS))
    print(f"Run results: {output}", flush=True)
    succeeded = True
    with ThreadPoolExecutor(max_workers=min(args.parallel, len(args.task))) as pool:
        jobs = {
            pool.submit(
                run_agent,
                executable,
                prompt,
                output / name,
                args.model,
                args.write,
                args.timeout,
            ): name
            for name, prompt in args.task
        }
        for job in as_completed(jobs):
            name = jobs[job]
            try:
                status = job.result()
            except OSError as error:
                print(f"{name}: could not launch ({error})", flush=True)
                succeeded = False
                continue
            print(f"{name}: exit {status}", flush=True)
            succeeded &= status == 0
    raise SystemExit(0 if succeeded else 1)


if __name__ == "__main__":
    main()
