"""Needle-shaped triangles against 80-digit arithmetic.

The inputs are the exact binary64 values Intrinsic used, so the reference is
the exact area and angles of that triangle, not of the decimal numbers it was
generated from. Kahan's formulas promise a few units of roundoff; the measured
worst cases on 2026-11-12 were 1.93 (area) and 2.12 (angle) units.
"""

from __future__ import annotations

import pytest
from mpmath import mp, mpf

from .fixtures import UNIT_ROUNDOFF, Needle, needles

NEEDLES = needles()
TOLERANCE = 4 * UNIT_ROUNDOFF


def exact_area(a: float, b: float, c: float) -> mpf:
    x, y, z = mpf(a), mpf(b), mpf(c)
    s = (x + y + z) / 2
    return mp.sqrt(s * (s - x) * (s - y) * (s - z))


def exact_angle(opposite: float, a: float, b: float) -> mpf:
    c, x, y = mpf(opposite), mpf(a), mpf(b)
    return mp.acos((x * x + y * y - c * c) / (2 * x * y))


def test_there_are_enough_needles() -> None:
    assert len(NEEDLES) >= 150


@pytest.mark.parametrize("needle", NEEDLES)
def test_area_is_accurate_to_a_few_units_of_roundoff(needle: Needle) -> None:
    mp.dps = 80
    exact = exact_area(*needle.sides)
    assert abs(mpf(needle.area) - exact) <= TOLERANCE * exact


@pytest.mark.parametrize("needle", NEEDLES)
def test_angles_are_accurate_to_a_few_units_of_roundoff(needle: Needle) -> None:
    mp.dps = 80
    a, b, c = needle.sides
    for computed, (opposite, x, y) in zip(
        needle.angles, ((a, b, c), (b, c, a), (c, a, b)), strict=True
    ):
        exact = exact_angle(opposite, x, y)
        assert abs(mpf(computed) - exact) <= TOLERANCE * exact
