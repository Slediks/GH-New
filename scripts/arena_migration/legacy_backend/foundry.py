"""Foundry v2: 88 x 68 m. Symmetric routes, shared collision and named industrial zones.

Coordinates are metres. y is the bottom of a solid. Small visual dressing is
client-only; every large obstacle and walkable level is represented here.
"""

BOXES, SURFACES = [], []


def solid(x, y, z, width, height, depth, surface):
    BOXES.append([x, y, z, width, height, depth])
    SURFACES.append(surface)


def stair(x, start_z, count, tread, width=3):
    for step in range(count):
        solid(x, 0, start_z + step * tread, width, (step + 1) * 0.25, tread, "step")


def perimeter_and_yards():
    for x in (-45, 45):
        solid(x, 0, 0, 1, 11, 70, "boundary")
    for z in (-35, 35):
        solid(0, 0, z, 91, 11, 1, "boundary")
    for side in (-1, 1):
        # Three exits: north/south plus a dog-leg through the central blast screen.
        for z in (-11, 11):
            solid(side * 31, 0, z, 1, 8, 16, "concrete")
        solid(side * 34, 0, 0, 1, 8, 12, "concrete")
        for z in (-27, 27):
            solid(side * 37, 0, z, 5, 3, 4, "crate")
        # Intermediate loading/maintenance cover, not a closed corridor.
        solid(side * 27, 0, -6, 4, 3.5, 4, "transformer")
        solid(side * 27, 0, 9, 4, 3, 5, "compressor")


def core():
    solid(0, 0, 0, 8, 8, 10, "furnace")
    for side in (-1, 1):
        solid(side * 11, 0, 1, 4, 3, 6, "machine")
        solid(side * 18, 0, 9, 4, 5, 4, "tank")
        for z in (-14, 14):
            solid(side * 23, 0, z, 2, 9, 2, "column")
    for z in (-14, 14):
        solid(0, 9, z, 48, 0.6, 1, "beam")
    # Gantry geometry is also known to server rays, including its overhead trolley.
    for side in (-1, 1):
        for z in (-14, 14):
            solid(side * 23, 9, z, 0.6, 3, 0.7, "beam")
        solid(side * 23, 11.4, 0, 0.6, 0.6, 28, "beam")
        solid(side * 15, 10.6, 0, 3, 0.8, 4, "beam")
    for z in (-14, 14):
        solid(0, 11.425, z, 48, 0.55, 0.6, "beam")
    # 3.5 m catwalk, two broad approaches and an open passage underneath.
    solid(0, 3.25, -11, 44, 0.25, 4, "deck")
    for side in (-1, 1):
        stair(side * 20, -21.1, 14, 0.6)
        solid(side * 13, 3.5, -8.95, 18, 0.9, 0.1, "rail")
    solid(0, 3.5, -13.05, 32, 0.9, 0.1, "rail")


def container_yard():
    for side in (-1, 1):
        solid(side * 22, 0, -27, 9, 3, 4, "container")
        solid(side * 9, 0, -24, 7, 3, 4, "container")
        solid(side * 22, 3, -27, 9, 3, 4, "container")
        solid(side * 35, 0, -31, 5, 2.5, 3, "cargo")
    solid(0, 0, -31, 5, 3, 3, "cargo")


def warehouse():
    # Wide front and rear doors plus two side loading doors. The floor loop is open.
    for side in (-1, 1):
        solid(side * 14, 0, 18, 20, 8, 0.6, "warehouse")
        solid(side * 14, 0, 33, 20, 8, 0.6, "warehouse")
        solid(side * 24, 0, 19.5, 0.6, 8, 3, "warehouse")
        solid(side * 24, 0, 30, 0.6, 8, 6, "warehouse")
        solid(side * 11, 0, 25, 3, 4.5, 8, "rack")
        solid(side * 5, 0, 22, 3, 2, 3, "cargo")
        stair(side * 18, 22.75, 12, 0.5)
    solid(0, 8, 25.5, 48.6, 0.4, 15.6, "roof")
    solid(0, 2.75, 30, 40, 0.25, 3, "deck")
    solid(0, 3, 28.45, 28, 0.9, 0.1, "rail")
    solid(0, 3, 31.55, 40, 0.9, 0.1, "rail")


perimeter_and_yards()
core()
container_yard()
warehouse()
SPAWNS = {
    "Alpha": [[-38, z] for z in (-10, -6, -2, 2, 6, 10)] + [[-41, -6], [-41, 6]],
    "Bravo": [[38, z] for z in (-10, -6, -2, 2, 6, 10)] + [[41, -6], [41, 6]],
    "neutral": [
        [side * x, z]
        for side in (-1, 1)
        for x, z in (
            (39, -12),
            (39, 12),
            (40, -28),
            (40, 28),
            (29, -19),
            (29, 19),
            (14, -31),
            (4, -18),
            (26, 2),
            (16, 15),
            (20, 25),
            (5, 26),
            (7, 8),
            (7, -5),
            (29, 30),
            (41, 0),
        )
    ],
}
MAP = dict(
    id="foundry",
    name="Foundry",
    version=2,
    enabled=True,
    team_respawns=True,
    boxes=BOXES,
    surfaces=SURFACES,
    spawns=SPAWNS,
    bounds=dict(bound_x=44.0, bound_z=34.0),
)
