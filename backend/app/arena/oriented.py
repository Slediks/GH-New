"""Compiled box: legacy broad bounds, then optional XYZ unit axes and half extents."""

import math
from functools import lru_cache
from itertools import product


def compile_box(box, obj):
    x, y, z, w, h, d = box
    scale = obj["scale"]
    a, b, c = map(math.radians, obj["rotation"])
    A, B, C = math.cos(a), math.cos(b), math.cos(c)
    u, v, t = math.sin(a), math.sin(b), math.sin(c)
    # Columns of THREE.Euler(XYZ)'s rotation matrix.
    axes = [
        [B * C, A * t + u * v * C, u * t - A * v * C],
        [-B * t, A * C - u * v * t, u * C + A * v * t],
        [v, -u * B, A * B],
    ]
    axes = [[round(n) if abs(n - round(n)) < 1e-12 else n for n in col] for col in axes]
    half = [size * s / 2 for size, s in zip((w, h, d), scale)]
    local = [n * s for n, s in zip((x, y + h / 2, z), scale)]
    center = [
        p + sum(local[j] * axes[j][i] for j in range(3)) for i, p in enumerate(obj["position"])
    ]
    extent = [sum(half[j] * abs(axes[j][i]) for j in range(3)) for i in range(3)]
    broad = [center[0], center[1] - extent[1], center[2], *(2 * n for n in extent)]
    if all(n in (-1, 0, 1) for axis in axes for n in axis):
        return broad
    return broad + [n for axis in axes for n in axis] + half


def local_ray(b, origin, direction):
    delta = [origin[0] - b[0], origin[1] - b[1] - b[4] / 2, origin[2] - b[2]]

    def project(vec):
        return [sum(vec[k] * b[6 + i * 3 + k] for k in range(3)) for i in range(3)]

    return project(delta), project(direction)


@lru_cache(maxsize=2048)
def corners(box):
    center = (box[0], box[1] + box[4] / 2, box[2])
    return [
        tuple(
            center[k] + sum(s[j] * box[15 + j] * box[6 + 3 * j + k] for j in range(3))
            for k in range(3)
        )
        for s in product((-1, 1), repeat=3)
    ]


def column(b, x, z, r):
    """Vertical extent inside a circular footprint. Extrema lie on a vertex,
    an edge crossing the circle, or a face tangent to the circle in projection."""
    if abs(x - b[0]) >= b[3] / 2 + r or abs(z - b[2]) >= b[5] / 2 + r:
        return None
    cx, cy, cz = b[0], b[1] + b[4] / 2, b[2]
    if abs(b[10]) > 1 - 1e-12 and abs(b[7]) + abs(b[13]) < 1e-12:
        dx, dz = x - cx, z - cz
        a = max(0, abs(dx * b[6] + dz * b[8]) - b[15])
        c = max(0, abs(dx * b[12] + dz * b[14]) - b[17])
        return (b[1], b[1] + b[4]) if a * a + c * c < r * r - 1e-8 else None
    vertices = corners(tuple(b))
    ys = []
    for i, (px, py, pz) in enumerate(vertices):
        dx, dz = px - x, pz - z
        q = dx * dx + dz * dz - r * r
        if q <= 0:
            ys.append(py)
        for mask in (1, 2, 4):
            if i & mask:
                continue
            ex, ey, ez = vertices[i | mask]
            vx, vz = ex - px, ez - pz
            length = vx * vx + vz * vz
            dot = dx * vx + dz * vz
            disc = dot * dot - length * q
            if length < 1e-16 or disc < 0:
                continue
            for f in ((-dot - math.sqrt(disc)) / length, (-dot + math.sqrt(disc)) / length):
                if 0 <= f <= 1:
                    ys.append(py + f * (ey - py))
    for i in range(3):
        nx, ny, nz = b[6 + 3 * i : 9 + 3 * i]
        if abs(ny) < 1e-10:
            continue
        length = math.hypot(nx, nz)
        for sign in (-1, 1):
            for side in (-1, 1):
                px = x + (side * r * nx / length if length else 0)
                pz = z + (side * r * nz / length if length else 0)
                py = cy + (sign * b[15 + i] - nx * (px - cx) - nz * (pz - cz)) / ny
                if all(
                    abs(
                        (px - cx) * b[6 + 3 * j]
                        + (py - cy) * b[7 + 3 * j]
                        + (pz - cz) * b[8 + 3 * j]
                    )
                    <= b[15 + j] + 1e-8
                    for j in range(3)
                ):
                    ys.append(py)
    return (min(ys), max(ys)) if ys else None


def at_footprint(boxes, x, z, r):
    for b in boxes:
        if len(b) == 6:
            yield b
        else:
            span = column(b, x, z, r)
            if span:
                yield (x, span[0], z, 2 * r, span[1] - span[0], 2 * r)
