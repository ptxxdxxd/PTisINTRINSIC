#!/usr/bin/env python3
"""Mutation check: break the code on purpose and confirm a test notices.

Each entry of mutants.json replaces one piece of source text with a plausible
bug. The list is curated by hand: it covers the places where a slip is easy
and silent, and it is not a mutation score over every line. The repository is
copied to a temporary directory first, so the working tree is never touched.
A mutant is "caught" when the unit tests fail (or, for entries marked
"check": "oracle", when the Python differential tests fail on fixtures
exported from the mutated code).

Entries with an "equivalent" reason are expected to survive: the change cannot
alter behaviour, and the reason says why. Any other survivor, and any entry
whose text is no longer found exactly once, makes this script exit with 1.

Usage, from the repository root (after `npm ci`):

    python3 scripts/mutation/run.py [--python PATH_TO_ORACLE_PYTHON] [--only TEXT]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP = shutil.ignore_patterns(
    "node_modules",
    "dist",
    "coverage",
    ".git",
    "test-results",
    "playwright-report",
    "screenshots",
    ".venv",
    "fixtures",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
)


def run(command: list[str], cwd: Path) -> bool:
    """True when the command succeeds."""
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=1800)
    return result.returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--python", help="interpreter with oracle/requirements.txt installed")
    parser.add_argument("--only", help="run only mutants whose label contains this text")
    arguments = parser.parse_args()
    # Commands run inside the copy, so a relative interpreter path would be
    # looked up there. abspath, not resolve(): resolving the symlink would
    # leave the virtual environment.
    python = os.path.abspath(arguments.python) if arguments.python else None
    mutants = json.loads((Path(__file__).parent / "mutants.json").read_text(encoding="utf-8"))
    if arguments.only:
        mutants = [m for m in mutants if arguments.only in m["label"]]

    caught = survived_as_expected = problems = skipped = 0
    with tempfile.TemporaryDirectory() as scratch:
        copy = Path(scratch) / "repo"
        shutil.copytree(ROOT, copy, ignore=SKIP)
        (copy / "node_modules").symlink_to(ROOT / "node_modules")
        if not run(["npx", "vitest", "run"], copy):
            print("the unit tests fail before any mutation; fix that first")
            return 1

        for mutant in mutants:
            label = mutant["label"]
            target = copy / mutant["file"]
            original = target.read_text(encoding="utf-8")
            if original.count(mutant["find"]) != 1:
                print(f"STALE     {label}: text found {original.count(mutant['find'])} times")
                problems += 1
                continue
            target.write_text(original.replace(mutant["find"], mutant["replace"]), encoding="utf-8")
            try:
                if mutant.get("check") == "oracle":
                    if python is None:
                        print(f"SKIPPED   {label}: needs --python")
                        skipped += 1
                        continue
                    # A mutant that breaks the export itself is caught too.
                    exported = run(["node", "scripts/export-fixtures.ts"], copy)
                    passed = exported and run([python, "-m", "pytest", "-q", "-x"], copy / "oracle")
                else:
                    passed = run(["npx", "vitest", "run", "--bail", "1"], copy)
            finally:
                target.write_text(original, encoding="utf-8")

            reason = mutant.get("equivalent")
            if not passed and reason is None:
                caught += 1
                print(f"CAUGHT    {label}")
            elif passed and reason is not None:
                survived_as_expected += 1
                print(f"SURVIVED  {label} (expected: {reason})")
            elif passed:
                problems += 1
                print(f"MISSED    {label}")
            else:
                problems += 1
                print(f"CAUGHT?   {label}: marked equivalent ({reason}) but a test failed")

    print(
        f"{caught} caught, {survived_as_expected} equivalent as expected, "
        f"{skipped} skipped, {problems} problems, of {len(mutants)}"
    )
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
