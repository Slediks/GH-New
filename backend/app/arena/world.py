"""Map-independent ray geometry; callers provide the published collision snapshot."""


def ray_box(origin, direction, low, high):
    near, far = 0.0, float("inf")
    for i in range(3):
        if abs(direction[i]) < 1e-9:
            if not low[i] <= origin[i] <= high[i]:
                return None
        else:
            a, b = (low[i] - origin[i]) / direction[i], (high[i] - origin[i]) / direction[i]
            near, far = max(near, min(a, b)), min(far, max(a, b))
            if near > far:
                return None
    return near


def box_distance(origin, direction, box):
    """First intersection with the same compiled box used by server shots."""
    if len(box) > 6:
        from backend.app.arena.oriented import local_ray

        pos, ray = local_ray(box, origin, direction)
        return ray_box(pos, ray, [-n for n in box[15:18]], box[15:18])
    x, y, z, w, h, d = box
    return ray_box(origin, direction, [x - w / 2, y, z - d / 2], [x + w / 2, y + h, z + d / 2])


def wall_distance(origin, direction, boxes):
    result = 1000.0
    for box in boxes:
        hit = box_distance(origin, direction, box)
        if hit is not None:
            result = min(result, hit)
    return result
