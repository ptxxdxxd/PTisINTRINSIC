"""The app's VTK, OBJ and CSV exports, read back with meshio and numpy.

The files are written by the same functions the app's export buttons call
(src/core/exporters.ts). Every number must come back as the identical double:
the exporter writes the shortest decimal that round-trips.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import meshio
import numpy as np
import pytest
from numpy.typing import NDArray

from .fixtures import FIXTURE_DIRECTORY

EXPORTS = FIXTURE_DIRECTORY / "exports"
NAMES = ["bump", "cone"]


def expected(name: str) -> tuple[NDArray[np.float64], NDArray[np.int64], dict[str, Any]]:
    with (EXPORTS / f"{name}.json").open(encoding="utf-8") as handle:
        raw = json.load(handle)
    fields = {
        f["name"].replace(" ", "_"): np.array(
            [np.nan if x is None else x for x in f["values"]], dtype=np.float64
        )
        for f in raw["fields"]
    }
    positions = np.asarray(raw["positions"], dtype=np.float64).reshape(-1, 3)
    return positions, np.asarray(raw["faces"], dtype=np.int64).reshape(-1, 3), fields


def triangles(mesh: Any) -> NDArray[np.int64]:
    blocks = [block.data for block in mesh.cells if block.type == "triangle"]
    assert len(blocks) == 1
    return np.asarray(blocks[0], dtype=np.int64)


def test_exports_include_undefined_values() -> None:
    for name in NAMES:
        _, _, fields = expected(name)
        assert np.isnan(fields["gaussian_curvature"]).any()
        assert not np.isnan(fields["geodesic_distance"]).any()


@pytest.mark.parametrize("name", NAMES)
def test_vtk_reads_back_exactly(name: str) -> None:
    positions, faces, fields = expected(name)
    mesh = meshio.read(EXPORTS / f"{name}.vtk")
    np.testing.assert_array_equal(mesh.points, positions)
    np.testing.assert_array_equal(triangles(mesh), faces)
    assert set(mesh.point_data) == set(fields)
    for key, values in fields.items():
        # assert_array_equal treats NaN in the same places as equal.
        np.testing.assert_array_equal(np.asarray(mesh.point_data[key]).ravel(), values)


@pytest.mark.parametrize("name", NAMES)
def test_obj_reads_back_exactly(name: str) -> None:
    positions, faces, _ = expected(name)
    mesh = meshio.read(EXPORTS / f"{name}.obj")
    np.testing.assert_array_equal(mesh.points, positions)
    np.testing.assert_array_equal(triangles(mesh), faces)


@pytest.mark.parametrize("name", NAMES)
def test_csv_reads_back_exactly(name: str) -> None:
    positions, _, fields = expected(name)
    path: Path = EXPORTS / f"{name}.csv"
    header = path.read_text(encoding="utf-8").splitlines()[0].split(",")
    assert header == ["vertex", "x", "y", "z", *fields]
    # Empty cells (undefined values) come back as NaN.
    table = np.genfromtxt(path, delimiter=",", skip_header=1)
    np.testing.assert_array_equal(table[:, 0], np.arange(len(positions)))
    np.testing.assert_array_equal(table[:, 1:4], positions)
    for column, values in enumerate(fields.values(), start=4):
        np.testing.assert_array_equal(table[:, column], values)
