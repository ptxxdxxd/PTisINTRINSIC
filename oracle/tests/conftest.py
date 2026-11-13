from __future__ import annotations

import pytest

from .fixtures import FIXTURE_DIRECTORY


def pytest_sessionstart(session: pytest.Session) -> None:
    if not (FIXTURE_DIRECTORY / "needles.json").is_file():
        pytest.exit(
            f"{FIXTURE_DIRECTORY} is missing: run `npm run fixtures` from the repository root",
            returncode=4,
        )
