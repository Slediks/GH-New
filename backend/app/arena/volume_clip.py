"""Cover a circular footprint with polygonal sections valid for the full player height."""


def clip(poly, a, b, c):
    result = []
    for p, q in zip(poly, poly[1:] + poly[:1]):
        u = a * p[0] + b * p[1] - c
        v = a * q[0] + b * q[1] - c
        if u <= 0:
            result.append(p)
        if (u <= 0) != (v <= 0):
            t = u / (u - v)
            result.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return result


def intersects(poly, r):
    if len(poly) < 3:
        return False
    inside = True
    for p, q in zip(poly, poly[1:] + poly[:1]):
        dx, dz = q[0] - p[0], q[1] - p[1]
        if dx * (-p[1]) - dz * (-p[0]) < -1e-10:
            inside = False
        t = max(0, min(1, -(dx * p[0] + dz * p[1]) / max(1e-20, dx * dx + dz * dz)))
        if (p[0] + t * dx) ** 2 + (p[1] + t * dz) ** 2 < r * r - 1e-9:
            return True
    return inside


def covered(x, y, z, h, r, boxes):
    remaining = [[(-r, -r), (r, -r), (r, r), (-r, r)]]
    for box in boxes:
        if abs(box[0] - x) > box[3] / 2 + r or abs(box[2] - z) > box[5] / 2 + r:
            continue
        center = (box[0] - x, box[1] + box[4] / 2 - y, box[2] - z)
        axes = box[6:15] if len(box) > 6 else (1, 0, 0, 0, 1, 0, 0, 0, 1)
        half = box[15:18] if len(box) > 6 else [s / 2 for s in box[3:6]]
        fragments = []
        for poly in remaining:
            for i in range(6):
                j = i // 2
                sign = 1 if i % 2 else -1
                a, b, c = [sign * k for k in axes[3 * j : 3 * j + 3]]
                limit = (
                    half[j] + a * center[0] + b * center[1] + c * center[2] - max(0, b * h) + 1e-8
                )
                if abs(a) + abs(c) < 1e-12:
                    if limit < 0:
                        fragments.append(poly)
                        break
                    continue
                outside = clip(poly, -a, -c, -limit)
                if intersects(outside, r):
                    fragments.append(outside)
                poly = clip(poly, a, c, limit)
                if not poly:
                    break
        remaining = fragments
        if not remaining:
            return True
    return False
