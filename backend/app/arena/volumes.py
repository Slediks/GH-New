"""Exact circular footprint containment in a union of axis-aligned volumes."""


def contains(x, y, z, height, radius, allowed, excluded=()):
    if not allowed:
        return True
    from backend.app.arena.oriented import column

    for b in excluded:
        if len(b) > 6:
            s = column(b, x, z, radius)
            if s and y + height > s[0] and y < s[1]:
                return False
    excluded = [b for b in excluded if len(b) == 6]
    if any(len(b) > 6 for b in allowed):
        from backend.app.arena.volume_clip import covered

        return covered(x, y, z, height, radius, allowed) and not any(
            y + height > b[1]
            and y < b[1] + b[4]
            and max(abs(x - b[0]) - b[3] / 2, 0) ** 2 + max(abs(z - b[2]) - b[5] / 2, 0) ** 2
            < radius**2 + 1e-9
            for b in excluded
        )
    eligible = [b for b in allowed if b[1] - 1e-5 <= y and y + height <= b[1] + b[4] + 1e-5]

    def in_box(b, px, pz):
        return (
            b[0] - b[3] / 2 - 1e-8 <= px <= b[0] + b[3] / 2 + 1e-8
            and b[2] - b[5] / 2 - 1e-8 <= pz <= b[2] + b[5] / 2 + 1e-8
        )

    if not any(in_box(b, x, z) for b in eligible):
        return False
    for b in excluded:
        dx = max(abs(x - b[0]) - b[3] / 2, 0)
        dz = max(abs(z - b[2]) - b[5] / 2, 0)
        if y + height > b[1] and y < b[1] + b[4] and dx * dx + dz * dz < radius * radius + 1e-9:
            return False
    xs = sorted(
        {x - radius, x + radius}
        | {
            v
            for b in eligible
            for v in (b[0] - b[3] / 2, b[0] + b[3] / 2)
            if x - radius < v < x + radius
        }
    )
    zs = sorted(
        {z - radius, z + radius}
        | {
            v
            for b in eligible
            for v in (b[2] - b[5] / 2, b[2] + b[5] / 2)
            if z - radius < v < z + radius
        }
    )
    for a, c in zip(xs, xs[1:]):
        for b, d in zip(zs, zs[1:]):
            dx = max(a - x, 0, x - c)
            dz = max(b - z, 0, z - d)
            if dx * dx + dz * dz < radius * radius - 1e-8 and not any(
                in_box(v, (a + c) / 2, (b + d) / 2) for v in eligible
            ):
                return False
    return True
