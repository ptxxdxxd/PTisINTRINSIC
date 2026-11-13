"""Meshes built directly with numpy, independently of the TypeScript generators."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

Vertices = NDArray[np.float64]
Faces = NDArray[np.int64]


def unit_square_grid(n: int) -> tuple[Vertices, Faces]:
    """(n+1)^2 vertices on [0, 1]^2 in the z = 0 plane; each cell is split along one diagonal."""
    if n < 1:
        raise ValueError("n must be at least 1")
    ticks = np.linspace(0.0, 1.0, n + 1)
    xs, ys = np.meshgrid(ticks, ticks)
    vertices = np.column_stack([xs.ravel(), ys.ravel(), np.zeros(xs.size)])
    faces: list[tuple[int, int, int]] = []
    for row in range(n):
        for col in range(n):
            lower_left = row * (n + 1) + col
            lower_right = lower_left + 1
            upper_left = lower_left + (n + 1)
            upper_right = upper_left + 1
            faces.append((lower_left, lower_right, upper_right))
            faces.append((lower_left, upper_right, upper_left))
    return vertices, np.asarray(faces, dtype=np.int64)
