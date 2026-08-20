#!/usr/bin/env python3
"""Validate draw.io XML structure and rendered diagram geometry.

The XML checks catch broken mxGraph references. When the draw.io desktop CLI is
available, SVG checks validate the geometry that draw.io actually renders.
The script intentionally uses only Python's standard library.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

EPSILON = 1e-7
DEFAULT_DRAWIO = "/Applications/draw.io.app/Contents/MacOS/draw.io"
NUMBER_RE = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
PATH_TOKEN_RE = re.compile(rf"[AaCcHhLlMmQqSsTtVvZz]|{NUMBER_RE}")
TRANSFORM_RE = re.compile(rf"([A-Za-z]+)\s*\(([^)]*)\)")


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height

    @property
    def center(self) -> Point:
        return Point(self.x + self.width / 2, self.y + self.height / 2)

    def inflate(self, amount: float) -> "Rect":
        return Rect(
            self.x - amount,
            self.y - amount,
            self.width + 2 * amount,
            self.height + 2 * amount,
        )


@dataclass
class Finding:
    severity: str
    code: str
    message: str
    page: Optional[str] = None
    cell: Optional[str] = None

    def as_dict(self) -> dict:
        result = {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
        }
        if self.page is not None:
            result["page"] = self.page
        if self.cell is not None:
            result["cell"] = self.cell
        return result


@dataclass
class Report:
    path: str
    findings: List[Finding]

    def error_count(self) -> int:
        return sum(f.severity == "error" for f in self.findings)

    def warning_count(self) -> int:
        return sum(f.severity == "warning" for f in self.findings)

    def as_dict(self, strict: bool) -> dict:
        errors = self.error_count()
        warnings = self.warning_count()
        return {
            "file": self.path,
            "ok": errors == 0 and (not strict or warnings == 0),
            "errors": errors,
            "warnings": warnings,
            "findings": [f.as_dict() for f in self.findings],
        }


@dataclass
class Page:
    index: int
    name: str
    page_id: str
    model: ET.Element
    root: ET.Element
    cells: Dict[str, ET.Element]
    parents: Dict[str, Optional[str]]
    vertex_ids: List[str]
    edge_ids: List[str]
    geometry: Dict[str, ET.Element]
    rects: Dict[str, Rect]
    origins: Dict[str, Point]


# ---------------------------------------------------------------------------
# XML and graph helpers


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def children(element: ET.Element, name: str) -> List[ET.Element]:
    return [child for child in list(element) if local_name(child.tag) == name]


def child(element: ET.Element, name: str) -> Optional[ET.Element]:
    matches = children(element, name)
    return matches[0] if matches else None


def parse_float(
    element: ET.Element,
    attribute: str,
    default: Optional[float] = None,
) -> Optional[float]:
    value = element.get(attribute)
    if value is None or value == "":
        return default
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def style_map(style: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for item in style.split(";"):
        if "=" in item:
            key, value = item.split("=", 1)
            result[key] = value
    return result


def is_hidden(cell: ET.Element) -> bool:
    if cell.get("visible") == "0":
        return True
    return style_map(cell.get("style", "")).get("visibility") == "hidden"


def is_container(cell: ET.Element) -> bool:
    styles = style_map(cell.get("style", ""))
    return styles.get("container") == "1" or styles.get("swimlane") == "1"


def is_effectively_hidden(page: Page, cell_id: str) -> bool:
    current: Optional[str] = cell_id
    seen: set[str] = set()
    while current is not None and current not in seen:
        seen.add(current)
        cell = page.cells.get(current)
        if cell is not None and is_hidden(cell):
            return True
        current = page.parents.get(current)
    return False


def point_from_element(element: ET.Element) -> Optional[Point]:
    x = parse_float(element, "x")
    y = parse_float(element, "y")
    if x is None or y is None:
        return None
    return Point(x, y)


def positive_overlap(a: Rect, b: Rect, tolerance: float = 0.0) -> bool:
    width = min(a.right, b.right) - max(a.x, b.x)
    height = min(a.bottom, b.bottom) - max(a.y, b.y)
    return width > tolerance and height > tolerance


def point_to_rect_boundary_distance(point: Point, rect: Rect) -> float:
    inside_x = rect.x - EPSILON <= point.x <= rect.right + EPSILON
    inside_y = rect.y - EPSILON <= point.y <= rect.bottom + EPSILON
    if inside_x and inside_y:
        return min(
            abs(point.x - rect.x),
            abs(rect.right - point.x),
            abs(point.y - rect.y),
            abs(rect.bottom - point.y),
        )
    dx = max(rect.x - point.x, 0.0, point.x - rect.right)
    dy = max(rect.y - point.y, 0.0, point.y - rect.bottom)
    return math.hypot(dx, dy)


def segment_intersects_rect(a: Point, b: Point, rect: Rect) -> bool:
    """Liang-Barsky segment/rectangle intersection."""
    dx = b.x - a.x
    dy = b.y - a.y
    t0, t1 = 0.0, 1.0
    for p, q in (
        (-dx, a.x - rect.x),
        (dx, rect.right - a.x),
        (-dy, a.y - rect.y),
        (dy, rect.bottom - a.y),
    ):
        if abs(p) < EPSILON:
            if q < 0:
                return False
            continue
        ratio = q / p
        if p < 0:
            if ratio > t1:
                return False
            t0 = max(t0, ratio)
        else:
            if ratio < t0:
                return False
            t1 = min(t1, ratio)
    return t0 <= t1 + EPSILON


def orientation(a: Point, b: Point, c: Point) -> float:
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)


def on_segment(a: Point, b: Point, p: Point) -> bool:
    return (
        min(a.x, b.x) - EPSILON <= p.x <= max(a.x, b.x) + EPSILON
        and min(a.y, b.y) - EPSILON <= p.y <= max(a.y, b.y) + EPSILON
        and abs(orientation(a, b, p)) <= EPSILON
    )


def segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool:
    o1 = orientation(a, b, c)
    o2 = orientation(a, b, d)
    o3 = orientation(c, d, a)
    o4 = orientation(c, d, b)

    if (
        ((o1 > EPSILON and o2 < -EPSILON) or (o1 < -EPSILON and o2 > EPSILON))
        and ((o3 > EPSILON and o4 < -EPSILON) or (o3 < -EPSILON and o4 > EPSILON))
    ):
        return True
    return (
        abs(o1) <= EPSILON
        and on_segment(a, b, c)
        or abs(o2) <= EPSILON
        and on_segment(a, b, d)
        or abs(o3) <= EPSILON
        and on_segment(c, d, a)
        or abs(o4) <= EPSILON
        and on_segment(c, d, b)
    )


def segments(points: Sequence[Point]) -> Iterable[Tuple[Point, Point]]:
    return zip(points, points[1:])


def union_rects(rects: Sequence[Rect]) -> Optional[Rect]:
    if not rects:
        return None
    left = min(r.x for r in rects)
    top = min(r.y for r in rects)
    right = max(r.right for r in rects)
    bottom = max(r.bottom for r in rects)
    return Rect(left, top, right - left, bottom - top)


def ancestors(page: Page, cell_id: str) -> set[str]:
    result: set[str] = set()
    current = page.parents.get(cell_id)
    seen: set[str] = set()
    while current is not None and current not in seen:
        result.add(current)
        seen.add(current)
        current = page.parents.get(current)
    return result


def is_ancestor(page: Page, possible_ancestor: str, cell_id: str) -> bool:
    return possible_ancestor in ancestors(page, cell_id)


def geometry_for(page: Page, cell_id: str) -> Optional[ET.Element]:
    return page.geometry.get(cell_id)


def global_origin(
    page: Page,
    cell_id: str,
    stack: Optional[set[str]] = None,
) -> Point:
    if cell_id in page.origins:
        return page.origins[cell_id]
    if stack is None:
        stack = set()
    if cell_id in stack:
        return Point(0.0, 0.0)
    current_stack = set(stack)
    current_stack.add(cell_id)

    cell = page.cells.get(cell_id)
    if cell is None:
        return Point(0.0, 0.0)
    parent_id = page.parents.get(cell_id)
    if parent_id in {None, "0", "1"}:
        base = Point(0.0, 0.0)
    else:
        base = global_origin(page, parent_id, current_stack)

    geo = geometry_for(page, cell_id)
    if geo is None:
        page.origins[cell_id] = base
        return base

    x = parse_float(geo, "x", 0.0)
    y = parse_float(geo, "y", 0.0)
    x = x if x is not None else 0.0
    y = y if y is not None else 0.0

    if geo.get("relative") == "1" and parent_id not in {None, "0", "1"}:
        parent_rect = rect_for(page, parent_id, current_stack)
        if parent_rect is not None:
            x *= parent_rect.width
            y *= parent_rect.height

    offset = next(
        (
            p
            for p in geo.iter()
            if local_name(p.tag) == "mxPoint" and p.get("as") == "offset"
        ),
        None,
    )
    if offset is not None:
        offset_point = point_from_element(offset)
        if offset_point is not None:
            x += offset_point.x
            y += offset_point.y

    result = Point(base.x + x, base.y + y)
    page.origins[cell_id] = result
    return result


def rect_for(
    page: Page,
    cell_id: str,
    stack: Optional[set[str]] = None,
) -> Optional[Rect]:
    if cell_id in page.rects:
        return page.rects[cell_id]
    geo = geometry_for(page, cell_id)
    if geo is None:
        return None
    width = parse_float(geo, "width", 0.0)
    height = parse_float(geo, "height", 0.0)
    if width is None or height is None:
        return None
    origin = global_origin(page, cell_id, stack)
    result = Rect(origin.x, origin.y, width, height)
    page.rects[cell_id] = result
    return result


def static_edge_route(page: Page, edge_id: str) -> Optional[List[Point]]:
    edge = page.cells[edge_id]
    source = edge.get("source")
    target = edge.get("target")
    source_rect = rect_for(page, source) if source else None
    target_rect = rect_for(page, target) if target else None
    if source_rect is None or target_rect is None:
        return None

    points = [source_rect.center]
    geo = geometry_for(page, edge_id)
    if geo is not None:
        array = next(
            (
                a
                for a in geo.iter()
                if local_name(a.tag) == "Array" and a.get("as") == "points"
            ),
            None,
        )
        if array is not None:
            parent_origin = global_origin(page, page.parents.get(edge_id, "1") or "1")
            for point_element in children(array, "mxPoint"):
                point = point_from_element(point_element)
                if point is not None:
                    points.append(Point(parent_origin.x + point.x, parent_origin.y + point.y))
    points.append(target_rect.center)
    return points


# ---------------------------------------------------------------------------
# SVG parsing helpers

Matrix = Tuple[float, float, float, float, float, float]
IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def multiply_matrix(a: Matrix, b: Matrix) -> Matrix:
    return (
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    )


def transform_point(matrix: Matrix, point: Point) -> Point:
    return Point(
        matrix[0] * point.x + matrix[2] * point.y + matrix[4],
        matrix[1] * point.x + matrix[3] * point.y + matrix[5],
    )


def transform_from_attribute(value: str) -> Matrix:
    result = IDENTITY
    for name, raw_args in TRANSFORM_RE.findall(value or ""):
        try:
            args = [float(v) for v in re.findall(NUMBER_RE, raw_args)]
        except ValueError:
            continue
        operation: Matrix
        lower = name.lower()
        if lower == "translate" and args:
            operation = (1, 0, 0, 1, args[0], args[1] if len(args) > 1 else 0)
        elif lower == "scale" and args:
            operation = (
                args[0],
                0,
                0,
                args[1] if len(args) > 1 else args[0],
                0,
                0,
            )
        elif lower == "matrix" and len(args) == 6:
            operation = tuple(args)  # type: ignore[assignment]
        elif lower == "rotate" and args:
            radians = math.radians(args[0])
            rotation: Matrix = (
                math.cos(radians),
                math.sin(radians),
                -math.sin(radians),
                math.cos(radians),
                0,
                0,
            )
            if len(args) >= 3:
                cx, cy = args[1], args[2]
                operation = multiply_matrix(
                    multiply_matrix((1, 0, 0, 1, cx, cy), rotation),
                    (1, 0, 0, 1, -cx, -cy),
                )
            else:
                operation = rotation
        else:
            continue
        result = multiply_matrix(result, operation)
    return result


def cubic(p0: Point, p1: Point, p2: Point, p3: Point, steps: int = 8) -> List[Point]:
    result = []
    for index in range(1, steps + 1):
        t = index / steps
        inverse = 1 - t
        result.append(
            Point(
                inverse**3 * p0.x
                + 3 * inverse**2 * t * p1.x
                + 3 * inverse * t**2 * p2.x
                + t**3 * p3.x,
                inverse**3 * p0.y
                + 3 * inverse**2 * t * p1.y
                + 3 * inverse * t**2 * p2.y
                + t**3 * p3.y,
            )
        )
    return result


def quadratic(p0: Point, p1: Point, p2: Point, steps: int = 8) -> List[Point]:
    result = []
    for index in range(1, steps + 1):
        t = index / steps
        inverse = 1 - t
        result.append(
            Point(
                inverse**2 * p0.x + 2 * inverse * t * p1.x + t**2 * p2.x,
                inverse**2 * p0.y + 2 * inverse * t * p1.y + t**2 * p2.y,
            )
        )
    return result


def parse_path(value: str) -> List[List[Point]]:
    """Parse common SVG path commands and sample curves into polylines."""
    tokens = PATH_TOKEN_RE.findall(value or "")
    command_letters = set("AaCcHhLlMmQqSsTtVvZz")
    index = 0
    command: Optional[str] = None
    x = y = 0.0
    start_x = start_y = 0.0
    last_cubic: Optional[Point] = None
    last_quadratic: Optional[Point] = None
    subpaths: List[List[Point]] = []
    current: Optional[List[Point]] = None

    def is_command(token: str) -> bool:
        return token in command_letters

    def take(count: int) -> Optional[List[float]]:
        nonlocal index
        if index + count > len(tokens) or any(
            is_command(t) for t in tokens[index : index + count]
        ):
            return None
        try:
            values = [float(t) for t in tokens[index : index + count]]
        except ValueError:
            return None
        index += count
        return values

    def add(point: Point) -> None:
        nonlocal current
        if current is None:
            current = []
            subpaths.append(current)
        current.append(point)

    while index < len(tokens):
        if is_command(tokens[index]):
            command = tokens[index]
            index += 1
        if command is None:
            break
        upper = command.upper()
        relative = command.islower()

        if upper == "Z":
            if current is not None:
                add(Point(start_x, start_y))
                x, y = start_x, start_y
            last_cubic = None
            last_quadratic = None
            command = None
            continue

        count = {
            "M": 2,
            "L": 2,
            "H": 1,
            "V": 1,
            "C": 6,
            "S": 4,
            "Q": 4,
            "T": 2,
            "A": 7,
        }.get(upper)
        if count is None:
            break
        values = take(count)
        if values is None:
            break

        if upper == "M":
            nx = values[0] + (x if relative else 0)
            ny = values[1] + (y if relative else 0)
            x, y = nx, ny
            start_x, start_y = x, y
            current = []
            subpaths.append(current)
            current.append(Point(x, y))
            command = "l" if relative else "L"
            last_cubic = None
            last_quadratic = None
        elif upper == "L":
            x = values[0] + (x if relative else 0)
            y = values[1] + (y if relative else 0)
            add(Point(x, y))
            last_cubic = None
            last_quadratic = None
        elif upper == "H":
            x = values[0] + (x if relative else 0)
            add(Point(x, y))
            last_cubic = None
            last_quadratic = None
        elif upper == "V":
            y = values[0] + (y if relative else 0)
            add(Point(x, y))
            last_cubic = None
            last_quadratic = None
        elif upper == "C":
            c1 = Point(
                values[0] + (x if relative else 0),
                values[1] + (y if relative else 0),
            )
            c2 = Point(
                values[2] + (x if relative else 0),
                values[3] + (y if relative else 0),
            )
            end = Point(
                values[4] + (x if relative else 0),
                values[5] + (y if relative else 0),
            )
            if current is None:
                add(Point(x, y))
            current.extend(cubic(Point(x, y), c1, c2, end))
            x, y = end.x, end.y
            last_cubic = c2
            last_quadratic = None
        elif upper == "S":
            c1 = (
                Point(2 * x - last_cubic.x, 2 * y - last_cubic.y)
                if last_cubic
                else Point(x, y)
            )
            c2 = Point(
                values[0] + (x if relative else 0),
                values[1] + (y if relative else 0),
            )
            end = Point(
                values[2] + (x if relative else 0),
                values[3] + (y if relative else 0),
            )
            if current is None:
                add(Point(x, y))
            current.extend(cubic(Point(x, y), c1, c2, end))
            x, y = end.x, end.y
            last_cubic = c2
            last_quadratic = None
        elif upper == "Q":
            control = Point(
                values[0] + (x if relative else 0),
                values[1] + (y if relative else 0),
            )
            end = Point(
                values[2] + (x if relative else 0),
                values[3] + (y if relative else 0),
            )
            if current is None:
                add(Point(x, y))
            current.extend(quadratic(Point(x, y), control, end))
            x, y = end.x, end.y
            last_quadratic = control
            last_cubic = None
        elif upper == "T":
            control = (
                Point(2 * x - last_quadratic.x, 2 * y - last_quadratic.y)
                if last_quadratic
                else Point(x, y)
            )
            end = Point(
                values[0] + (x if relative else 0),
                values[1] + (y if relative else 0),
            )
            if current is None:
                add(Point(x, y))
            current.extend(quadratic(Point(x, y), control, end))
            x, y = end.x, end.y
            last_quadratic = control
            last_cubic = None
        elif upper == "A":
            # The endpoint is sufficient for collision testing; arc extrema are
            # uncommon in draw.io edge routes and are rendered as a short path.
            x = values[5] + (x if relative else 0)
            y = values[6] + (y if relative else 0)
            add(Point(x, y))
            last_cubic = None
            last_quadratic = None

    return [path for path in subpaths if path]


def bbox_from_points(points: Sequence[Point]) -> Optional[Rect]:
    if not points:
        return None
    left = min(p.x for p in points)
    top = min(p.y for p in points)
    right = max(p.x for p in points)
    bottom = max(p.y for p in points)
    return Rect(left, top, right - left, bottom - top)


def svg_shape_bbox(element: ET.Element, matrix: Matrix) -> Optional[Rect]:
    tag = local_name(element.tag)
    if tag == "rect":
        x = parse_float(element, "x", 0.0)
        y = parse_float(element, "y", 0.0)
        width = parse_float(element, "width")
        height = parse_float(element, "height")
        if None in (x, y, width, height):
            return None
        points = [
            transform_point(matrix, Point(x, y)),
            transform_point(matrix, Point(x + width, y)),
            transform_point(matrix, Point(x + width, y + height)),
            transform_point(matrix, Point(x, y + height)),
        ]
        return bbox_from_points(points)
    if tag in {"ellipse", "circle"}:
        cx = parse_float(element, "cx", 0.0)
        cy = parse_float(element, "cy", 0.0)
        if tag == "circle":
            rx = ry = parse_float(element, "r")
        else:
            rx = parse_float(element, "rx")
            ry = parse_float(element, "ry")
        if None in (cx, cy, rx, ry):
            return None
        points = [
            transform_point(matrix, Point(cx - rx, cy - ry)),
            transform_point(matrix, Point(cx + rx, cy - ry)),
            transform_point(matrix, Point(cx + rx, cy + ry)),
            transform_point(matrix, Point(cx - rx, cy + ry)),
        ]
        return bbox_from_points(points)
    if tag == "line":
        points = [
            transform_point(
                matrix,
                Point(
                    parse_float(element, "x1", 0.0) or 0.0,
                    parse_float(element, "y1", 0.0) or 0.0,
                ),
            ),
            transform_point(
                matrix,
                Point(
                    parse_float(element, "x2", 0.0) or 0.0,
                    parse_float(element, "y2", 0.0) or 0.0,
                ),
            ),
        ]
        return bbox_from_points(points)
    if tag in {"polyline", "polygon"}:
        values = re.findall(NUMBER_RE, element.get("points", ""))
        if len(values) < 2:
            return None
        points = [
            transform_point(matrix, Point(float(values[i]), float(values[i + 1])))
            for i in range(0, len(values) - 1, 2)
        ]
        return bbox_from_points(points)
    if tag == "path":
        paths = parse_path(element.get("d", ""))
        points = [point for path in paths for point in path]
        return bbox_from_points([transform_point(matrix, point) for point in points])
    return None


def walk_owned(
    element: ET.Element,
    parent_matrix: Matrix,
    owner_id: str,
) -> Iterable[Tuple[ET.Element, Matrix]]:
    """Yield descendants belonging to one data-cell-id group with transforms."""
    current_matrix = multiply_matrix(
        parent_matrix,
        transform_from_attribute(element.get("transform", "")),
    )
    for descendant in list(element):
        descendant_id = descendant.get("data-cell-id")
        if descendant_id is not None and descendant_id != owner_id:
            continue
        descendant_matrix = multiply_matrix(
            current_matrix,
            transform_from_attribute(descendant.get("transform", "")),
        )
        yield descendant, descendant_matrix
        # Pass the matrix before the child transform; the child must not be
        # applied twice when the recursive call processes it.
        yield from walk_owned(descendant, current_matrix, owner_id)


def svg_groups(root: ET.Element) -> Dict[str, ET.Element]:
    result: Dict[str, ET.Element] = {}
    for element in root.iter():
        cell_id = element.get("data-cell-id")
        if cell_id is not None:
            result.setdefault(cell_id, element)
    return result


def rendered_cell_bbox(group: ET.Element, cell_id: str) -> Optional[Rect]:
    candidates: List[Rect] = []
    for element, matrix in walk_owned(group, IDENTITY, cell_id):
        if local_name(element.tag) not in {
            "rect",
            "ellipse",
            "circle",
            "line",
            "polyline",
            "polygon",
            "path",
        }:
            continue
        if element.get("pointer-events") == "none":
            continue
        bbox = svg_shape_bbox(element, matrix)
        if bbox is not None and bbox.width >= 0 and bbox.height >= 0:
            candidates.append(bbox)
    return union_rects(candidates)


def rendered_edge_route(group: ET.Element, cell_id: str) -> Optional[List[Point]]:
    fallback: Optional[List[Point]] = None
    for element, matrix in walk_owned(group, IDENTITY, cell_id):
        if local_name(element.tag) != "path":
            continue
        paths = parse_path(element.get("d", ""))
        if not paths:
            continue
        transformed = [
            transform_point(matrix, point) for point in max(paths, key=len)
        ]
        if len(transformed) < 2:
            continue
        if fallback is None:
            fallback = transformed

        pointer_events = element.get("pointer-events", "")
        style = element.get("style", "").replace(" ", "").lower()
        fill = element.get("fill", "").replace(" ", "").lower()
        # The main connector is normally the open, unfilled path. Arrowhead
        # paths are closed filled triangles and should not become the route.
        if (
            "stroke" in pointer_events
            or fill == "none"
            or "fill:none" in style
        ):
            return transformed
    return fallback


# ---------------------------------------------------------------------------
# Validator


class Validator:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.report: Optional[Report] = None
        self.rendered_routes: Dict[Tuple[int, str], List[Point]] = {}
        self.rendered_rects: Dict[Tuple[int, str], Rect] = {}

    def add(
        self,
        severity: str,
        code: str,
        message: str,
        page: Optional[str] = None,
        cell: Optional[str] = None,
    ) -> None:
        assert self.report is not None
        self.report.findings.append(Finding(severity, code, message, page, cell))

    def validate_file(self, path: Path) -> Report:
        self.report = Report(str(path), [])
        self.rendered_routes.clear()
        self.rendered_rects.clear()
        try:
            tree = ET.parse(path)
        except (ET.ParseError, OSError) as error:
            self.add("error", "xml-parse", str(error))
            return self.report

        root = tree.getroot()
        if local_name(root.tag) != "mxfile":
            self.add("error", "root-element", "document root must be <mxfile>")
            return self.report

        diagrams = children(root, "diagram")
        if not diagrams:
            self.add("error", "no-pages", "<mxfile> contains no <diagram> pages")
            return self.report

        seen_page_ids: set[str] = set()
        with tempfile.TemporaryDirectory(prefix="drawio-validate-") as temporary:
            temporary_path = Path(temporary)
            for index, diagram in enumerate(diagrams, start=1):
                page_id = diagram.get("id", f"page-{index}")
                page_name = diagram.get("name", page_id)
                if page_id in seen_page_ids:
                    self.add(
                        "error",
                        "duplicate-page-id",
                        f"duplicate diagram id {page_id!r}",
                        page_name,
                    )
                seen_page_ids.add(page_id)

                models = children(diagram, "mxGraphModel")
                if not models:
                    self.add(
                        "error",
                        "compressed-diagram",
                        "page has no child <mxGraphModel>; compressed/encoded diagram data is unsupported",
                        page_name,
                    )
                    continue
                if len(models) > 1:
                    self.add(
                        "error",
                        "multiple-models",
                        "page has more than one <mxGraphModel>",
                        page_name,
                    )
                model = models[0]

                roots = children(model, "root")
                if not roots:
                    self.add("error", "missing-root", "<mxGraphModel> has no <root>", page_name)
                    continue
                if len(roots) > 1:
                    self.add(
                        "error",
                        "multiple-roots",
                        "<mxGraphModel> has more than one <root>",
                        page_name,
                    )
                model_root = roots[0]

                page = self.make_page(index, page_name, page_id, model, model_root)
                self.validate_page(page)
                if self.args.no_render:
                    self.check_static_routes(page)
                else:
                    output = temporary_path / f"page-{index}.svg"
                    if self.args.render_dir:
                        render_dir = Path(self.args.render_dir)
                        render_dir.mkdir(parents=True, exist_ok=True)
                        safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", path.name)
                        output = render_dir / f"{safe_name}-page-{index}.svg"
                    self.render_page(path, page, output)

        return self.report

    def make_page(
        self,
        index: int,
        name: str,
        page_id: str,
        model: ET.Element,
        model_root: ET.Element,
    ) -> Page:
        cell_elements = [
            element
            for element in model_root.iter()
            if local_name(element.tag) == "mxCell"
        ]
        cells: Dict[str, ET.Element] = {}
        duplicate_ids: set[str] = set()
        for element in cell_elements:
            cell_id = element.get("id")
            if not cell_id:
                self.add("error", "missing-cell-id", "mxCell has no id", name)
                continue
            if cell_id in cells:
                duplicate_ids.add(cell_id)
            else:
                cells[cell_id] = element
        for duplicate_id in duplicate_ids:
            self.add(
                "error",
                "duplicate-cell-id",
                f"duplicate cell id {duplicate_id!r}",
                name,
                duplicate_id,
            )

        parents = {
            cell_id: element.get("parent")
            for cell_id, element in cells.items()
        }
        vertex_ids = [
            cell_id
            for cell_id, element in cells.items()
            if element.get("vertex") == "1"
        ]
        edge_ids = [
            cell_id
            for cell_id, element in cells.items()
            if element.get("edge") == "1"
        ]
        geometry = {
            cell_id: geometry_element
            for cell_id, element in cells.items()
            if (geometry_element := child(element, "mxGeometry")) is not None
        }
        return Page(
            index,
            name,
            page_id,
            model,
            model_root,
            cells,
            parents,
            vertex_ids,
            edge_ids,
            geometry,
            {},
            {},
        )

    def validate_page(self, page: Page) -> None:
        label = page.name
        if "0" not in page.cells:
            self.add(
                "error",
                "missing-root-cell",
                'page is missing mxCell id="0"',
                label,
            )
        elif page.parents.get("0") is not None:
            self.add(
                "error",
                "root-parent",
                'mxCell id="0" must not have a parent',
                label,
                "0",
            )
        if "1" not in page.cells:
            self.add(
                "error",
                "missing-layer-cell",
                'page is missing mxCell id="1"',
                label,
            )
        elif page.parents.get("1") != "0":
            self.add(
                "error",
                "layer-parent",
                'mxCell id="1" must have parent="0"',
                label,
                "1",
            )

        for cell_id, element in page.cells.items():
            if cell_id not in {"0", "1"}:
                parent_id = page.parents.get(cell_id)
                if not parent_id:
                    self.add("error", "missing-parent", "cell has no parent", label, cell_id)
                elif parent_id not in page.cells:
                    self.add(
                        "error",
                        "unknown-parent",
                        f"parent {parent_id!r} does not exist",
                        label,
                        cell_id,
                    )
            if element.get("vertex") == "1" and element.get("edge") == "1":
                self.add(
                    "error",
                    "vertex-edge-cell",
                    "cell cannot be both a vertex and an edge",
                    label,
                    cell_id,
                )

        for cell_id in page.cells:
            seen: set[str] = set()
            current: Optional[str] = cell_id
            while current is not None:
                if current in seen:
                    self.add(
                        "error",
                        "parent-cycle",
                        "parent references contain a cycle",
                        label,
                        cell_id,
                    )
                    break
                seen.add(current)
                current = page.parents.get(current)

        for cell_id in page.vertex_ids:
            element = page.cells[cell_id]
            geo = page.geometry.get(cell_id)
            if geo is None:
                self.add("error", "missing-geometry", "vertex has no mxGeometry", label, cell_id)
                continue
            width = parse_float(geo, "width")
            height = parse_float(geo, "height")
            if width is None or height is None:
                self.add(
                    "error",
                    "invalid-geometry",
                    "vertex width and height must be finite numbers",
                    label,
                    cell_id,
                )
                continue
            if width < 0 or height < 0:
                self.add(
                    "error",
                    "negative-size",
                    "vertex width and height cannot be negative",
                    label,
                    cell_id,
                )
            elif width <= EPSILON or height <= EPSILON:
                self.add(
                    "warning",
                    "zero-size",
                    "vertex has zero width or height",
                    label,
                    cell_id,
                )
            if (
                parse_float(geo, "x", 0.0) is None
                or parse_float(geo, "y", 0.0) is None
            ):
                self.add(
                    "error",
                    "invalid-geometry",
                    "vertex x and y must be finite numbers",
                    label,
                    cell_id,
                )
            rect = rect_for(page, cell_id)
            if rect is not None and width >= 0 and height >= 0:
                page.rects[cell_id] = rect

            if is_effectively_hidden(page, cell_id):
                continue

        for cell_id in page.edge_ids:
            element = page.cells[cell_id]
            source = element.get("source")
            target = element.get("target")
            if not source or not target:
                severity = "warning" if self.args.allow_floating else "error"
                self.add(
                    severity,
                    "unconnected-edge",
                    "edge must have both source and target IDs",
                    label,
                    cell_id,
                )
            else:
                if source not in page.cells:
                    self.add(
                        "error",
                        "unknown-source",
                        f"source {source!r} does not exist",
                        label,
                        cell_id,
                    )
                elif source not in page.vertex_ids:
                    self.add(
                        "error",
                        "source-not-vertex",
                        f"source {source!r} is not a box/shape vertex",
                        label,
                        cell_id,
                    )
                if target not in page.cells:
                    self.add(
                        "error",
                        "unknown-target",
                        f"target {target!r} does not exist",
                        label,
                        cell_id,
                    )
                elif target not in page.vertex_ids:
                    self.add(
                        "error",
                        "target-not-vertex",
                        f"target {target!r} is not a box/shape vertex",
                        label,
                        cell_id,
                    )
                if source == target:
                    self.add(
                        "warning",
                        "self-loop",
                        "edge source and target are the same shape",
                        label,
                        cell_id,
                    )
                if source in page.cells and is_effectively_hidden(page, source):
                    self.add(
                        "warning",
                        "hidden-source",
                        f"source shape {source!r} is hidden",
                        label,
                        cell_id,
                    )
                if target in page.cells and is_effectively_hidden(page, target):
                    self.add(
                        "warning",
                        "hidden-target",
                        f"target shape {target!r} is hidden",
                        label,
                        cell_id,
                    )

            geo = page.geometry.get(cell_id)
            if geo is None:
                self.add(
                    "error",
                    "missing-edge-geometry",
                    "edge has no mxGeometry",
                    label,
                    cell_id,
                )
            elif geo.get("relative") != "1":
                self.add(
                    "error",
                    "edge-not-relative",
                    'connected edge geometry must use relative="1"',
                    label,
                    cell_id,
                )

        for cell_id, element in page.cells.items():
            if (
                cell_id not in {"0", "1"}
                and element.get("vertex") != "1"
                and element.get("edge") != "1"
            ):
                self.add(
                    "warning",
                    "untyped-cell",
                    "cell is neither a vertex nor an edge",
                    label,
                    cell_id,
                )

        self.check_box_overlaps(page)

    def check_box_overlaps(self, page: Page) -> None:
        visible = [
            cell_id
            for cell_id in page.vertex_ids
            if not is_effectively_hidden(page, cell_id) and cell_id in page.rects
        ]
        for first, second in combinations(visible, 2):
            # Containment is intentional for groups/swimlanes and their children;
            # unrelated boxes with positive-area intersection are not.
            if is_ancestor(page, first, second) or is_ancestor(page, second, first):
                continue
            first_rect = page.rects[first]
            second_rect = page.rects[second]
            if positive_overlap(first_rect, second_rect):
                self.add(
                    "error",
                    "box-overlap",
                    f"boxes overlap: {first!r} and {second!r}",
                    page.name,
                    first,
                )

    def check_static_routes(self, page: Page) -> None:
        routes: Dict[str, List[Point]] = {}
        for edge_id in page.edge_ids:
            route = static_edge_route(page, edge_id)
            if route is None:
                continue
            routes[edge_id] = route
            edge = page.cells[edge_id]
            source = edge.get("source")
            target = edge.get("target")
            for first, second in segments(route):
                for vertex_id in page.vertex_ids:
                    if vertex_id in {source, target} or is_effectively_hidden(page, vertex_id):
                        continue
                    if is_ancestor(page, vertex_id, source or "") or is_ancestor(
                        page, vertex_id, target or ""
                    ):
                        continue
                    if vertex_id in page.rects and segment_intersects_rect(
                        first,
                        second,
                        page.rects[vertex_id].inflate(self.args.clearance),
                    ):
                        self.add(
                            "error",
                            "edge-box-overlap",
                            f"edge route intersects box {vertex_id!r}",
                            page.name,
                            edge_id,
                        )
                        break

        self.check_edge_crossings(page, routes)

    def check_edge_crossings(
        self,
        page: Page,
        routes: Dict[str, List[Point]],
    ) -> None:
        for first_id, second_id in combinations(routes, 2):
            first = page.cells[first_id]
            second = page.cells[second_id]
            first_endpoints = {first.get("source"), first.get("target")}
            second_endpoints = {second.get("source"), second.get("target")}
            if first_endpoints & second_endpoints:
                continue
            if any(
                segments_intersect(a, b, c, d)
                for a, b in segments(routes[first_id])
                for c, d in segments(routes[second_id])
            ):
                self.add(
                    "warning",
                    "edge-crossing",
                    f"edge routes cross: {first_id!r} and {second_id!r}",
                    page.name,
                    first_id,
                )

    def render_page(self, source: Path, page: Page, output: Path) -> None:
        drawio = find_drawio(self.args.drawio)
        if not executable_available(drawio):
            severity = "error" if self.args.require_render else "warning"
            self.add(
                severity,
                "renderer-unavailable",
                f"draw.io CLI not found at {drawio!r}",
                page.name,
            )
            self.check_static_routes(page)
            return

        output.parent.mkdir(parents=True, exist_ok=True)
        try:
            output.unlink()
        except FileNotFoundError:
            pass

        command = [
            drawio,
            "--disable-update",
            "--export",
            "--format",
            "svg",
            "--output",
            str(output),
            "--size",
            "diagram",
            "--theme",
            "light",
            "--border",
            "10",
            "--page-index",
            str(page.index),
            "--uncompressed",
            str(source),
        ]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self.args.timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            severity = "error" if self.args.require_render else "warning"
            self.add(
                severity,
                "render-failed",
                f"draw.io SVG export failed: {error}",
                page.name,
            )
            self.check_static_routes(page)
            return
        if result.returncode != 0 or not output.is_file():
            details = (result.stderr or result.stdout).strip()
            severity = "error" if self.args.require_render else "warning"
            message = f"draw.io SVG export failed (exit {result.returncode})"
            if details:
                message += f": {details[-300:]}"
            self.add(severity, "render-failed", message, page.name)
            self.check_static_routes(page)
            return

        try:
            svg_root = ET.parse(output).getroot()
        except (ET.ParseError, OSError) as error:
            self.add(
                "error",
                "svg-parse",
                f"rendered SVG is invalid: {error}",
                page.name,
            )
            return
        self.inspect_rendered_page(page, svg_root)

    def inspect_rendered_page(self, page: Page, svg_root: ET.Element) -> None:
        groups = svg_groups(svg_root)
        rendered_rects: Dict[str, Rect] = {}
        for cell_id in page.vertex_ids:
            if is_effectively_hidden(page, cell_id):
                continue
            group = groups.get(cell_id)
            if group is None:
                self.add(
                    "error",
                    "shape-not-rendered",
                    "vertex has no matching SVG cell group",
                    page.name,
                    cell_id,
                )
                continue
            rect = rendered_cell_bbox(group, cell_id)
            if rect is None:
                self.add(
                    "warning",
                    "shape-bounds-unknown",
                    "could not determine rendered shape bounds",
                    page.name,
                    cell_id,
                )
            else:
                rendered_rects[cell_id] = rect
                self.rendered_rects[(page.index, cell_id)] = rect

        routes: Dict[str, List[Point]] = {}
        for edge_id in page.edge_ids:
            edge = page.cells[edge_id]
            source = edge.get("source")
            target = edge.get("target")
            if not source or not target:
                continue
            group = groups.get(edge_id)
            if group is None:
                self.add(
                    "error",
                    "edge-not-rendered",
                    "edge has no matching SVG cell group",
                    page.name,
                    edge_id,
                )
                continue
            route = rendered_edge_route(group, edge_id)
            if route is None or len(route) < 2:
                self.add(
                    "error",
                    "edge-route-missing",
                    "could not determine rendered edge route",
                    page.name,
                    edge_id,
                )
                continue
            routes[edge_id] = route
            self.rendered_routes[(page.index, edge_id)] = route

            source_rect = rendered_rects.get(source)
            target_rect = rendered_rects.get(target)
            if source_rect is not None:
                distance = point_to_rect_boundary_distance(route[0], source_rect)
                if distance > self.args.endpoint_tolerance:
                    self.add(
                        "error",
                        "source-disconnected",
                        f"rendered edge starts {distance:.1f}px from source shape {source!r}",
                        page.name,
                        edge_id,
                    )
            if target_rect is not None:
                distance = point_to_rect_boundary_distance(route[-1], target_rect)
                if distance > self.args.endpoint_tolerance:
                    self.add(
                        "error",
                        "target-disconnected",
                        f"rendered edge ends {distance:.1f}px from target shape {target!r}",
                        page.name,
                        edge_id,
                    )

            for first, second in segments(route):
                for vertex_id, rect in rendered_rects.items():
                    if vertex_id in {source, target} or is_effectively_hidden(
                        page, vertex_id
                    ):
                        continue
                    if is_ancestor(page, vertex_id, source) or is_ancestor(
                        page, vertex_id, target
                    ):
                        continue
                    if segment_intersects_rect(
                        first,
                        second,
                        rect.inflate(self.args.clearance),
                    ):
                        self.add(
                            "error",
                            "rendered-edge-box-overlap",
                            f"rendered edge route intersects box {vertex_id!r}",
                            page.name,
                            edge_id,
                        )
                        break

        self.check_edge_crossings(page, routes)


def executable_available(value: str) -> bool:
    return Path(value).is_file() or shutil.which(value) is not None


def find_drawio(explicit: Optional[str]) -> str:
    if explicit:
        return explicit
    return shutil.which("drawio") or shutil.which("draw.io") or DEFAULT_DRAWIO


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate draw.io XML structure and rendered geometry."
    )
    parser.add_argument(
        "files",
        nargs="+",
        type=Path,
        help=".drawio or .drawio.xml files to validate",
    )
    parser.add_argument(
        "--no-render",
        action="store_true",
        help="skip draw.io SVG rendering and use XML geometry only",
    )
    parser.add_argument(
        "--require-render",
        action="store_true",
        help="fail if draw.io cannot render the page to SVG",
    )
    parser.add_argument("--drawio", help="path to the draw.io CLI executable")
    parser.add_argument(
        "--render-dir",
        help="keep rendered SVGs in this directory",
    )
    parser.add_argument(
        "--clearance",
        type=float,
        default=1.0,
        help="extra pixels around boxes for edge collision checks (default: 1)",
    )
    parser.add_argument(
        "--endpoint-tolerance",
        type=float,
        default=16.0,
        help="allowed rendered distance from an edge path endpoint to a shape (default: 16)",
    )
    parser.add_argument(
        "--allow-floating",
        action="store_true",
        help="allow edges without both endpoints, reported as warnings",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="treat warnings as failures",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="draw.io render timeout in seconds (default: 120)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit machine-readable JSON",
    )
    return parser.parse_args(argv)


def finding_location(finding: Finding) -> str:
    location = []
    if finding.page is not None:
        location.append(f"page={finding.page!r}")
    if finding.cell is not None:
        location.append(f"cell={finding.cell!r}")
    return f" ({', '.join(location)})" if location else ""


def print_human(report: Report, strict: bool) -> None:
    result = report.as_dict(strict)
    status = "PASS" if result["ok"] else "FAIL"
    print(
        f"{status}: {report.path} "
        f"({result['errors']} errors, {result['warnings']} warnings)"
    )
    for finding in report.findings:
        print(
            f"  {finding.severity.upper()} {finding.code}: "
            f"{finding.message}{finding_location(finding)}"
        )


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    validator = Validator(args)
    reports = [validator.validate_file(path) for path in args.files]

    if args.json:
        payload = [report.as_dict(args.strict) for report in reports]
        print(json.dumps(payload[0] if len(payload) == 1 else payload, indent=2))
    else:
        for report in reports:
            print_human(report, args.strict)

    return 0 if all(report.as_dict(args.strict)["ok"] for report in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
