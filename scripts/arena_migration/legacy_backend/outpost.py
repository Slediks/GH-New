"""Outpost: an irregular dry canyon, terraced ridge and fortified compound.

Metres; boxes use bottom y. Broad 20 cm terrain terraces are deliberately
shared by client collision and server rays, without changing movement physics.
The bounding rectangle is only a safety envelope, behind solid cliff volumes.
"""

BOXES, SURFACES = [], []
# South/north bands of the canyon. They define real solid boundaries, not a
# rectangular floor disguised by scenery. Adjacent bands overlap at their edge.
BANDS = [
    (-44, -30, -22, 28),
    (-30, -18, -40, 42),
    (-18, 12, -52, 52),
    (12, 30, -42, 42),
    (30, 42, -32, 20),
]


def solid(x, y, z, w, h, d, surface):
    BOXES.append([x, y, z, w, h, d])
    SURFACES.append(surface)


def cliffs():
    for i, (near, far, left, right) in enumerate(BANDS):
        solid((-60 + left) / 2, 0, (near + far) / 2, left + 60, 14 + i % 3, far - near, "cliff")
        solid((60 + right) / 2, 0, (near + far) / 2, 60 - right, 15 + i % 2, far - near, "cliff")
    solid(0, 0, -49, 120, 18, 10, "cliff")
    solid(0, 0, 47, 120, 16, 10, "cliff")
    # Rock promontories break the contour and create a low southern bypass.
    for x, z, w, h, d in [
        (-29, -10, 7, 6, 9),
        (30, 10, 8, 5, 8),
        (-15, 25, 14, 3.2, 6),
        (7, 27, 16, 3.5, 5),
        (-30, 34, 4, 5, 10),
        (17, 36, 6, 4, 8),
    ]:
        solid(x, 0, z, w, h, d, "rock")


def ridge():
    solid(-8.5, 0, -28, 11, 4, 8, "plateau")
    solid(11.5, 0, -28, 17, 4, 8, "plateau")
    solid(0, 2.7, -28, 6, 1.3, 8, "plateau")
    # Two earth ramps approach opposite ends of the plateau, not tower stairs.
    for i in range(20):
        solid(-33.5 + i, 0, -27, 1, (i + 1) * 0.2, 5, "terrain")
        solid(39.5 - i, 0, -26, 1, (i + 1) * 0.2, 4, "terrain")
    # Short, separated cover: the ridge is exposed to both lateral approaches.
    solid(-6, 4, -29, 5, 1, 1, "sandbag")
    solid(13, 4, -30, 3, 1, 1, "sandbag")
    solid(1, 4, -32, 4, 5, 3, "radar")


def starts():
    # Different-looking bases, comparable routes. The tall inner screens hide
    # all initial positions from the ridge; exits go around both ends.
    solid(-36, 0, 0, 1.2, 10, 24, "rock")
    solid(36, 0, 0, 1.2, 10, 24, "bunker")
    solid(-45, 0, -11, 6, 4, 3, "vehicle")
    solid(46, 0, 10, 7, 4, 3, "container")
    solid(-49, 0, 10, 3, 2, 4, "cargo")
    solid(48, 0, -7, 3, 3, 3, "generator")


def command():
    # 18 x 14 m building; two rooms, four doors, real windows in north facade.
    for x in (-7, 7):
        solid(x, 0, -7, 4, 5.5, 0.6, "concrete")
        solid(x, 0, 7, 4, 5.5, 0.6, "concrete")
    for x in (-3.5, 3.5):
        solid(x, 0, -7, 3, 1.05, 0.6, "concrete")
        solid(x, 2.5, -7, 3, 3, 0.6, "concrete")
        solid(x, 0, 7, 3, 5.5, 0.6, "concrete")
    for x in (-9, 9):
        for z in (-4.5, 4.5):
            solid(x, 0, z, 0.6, 5.5, 5, "concrete")
    solid(0, 0, -4.8, 0.4, 5.5, 4.4, "interior")
    solid(0, 0, 4.8, 0.4, 5.5, 4.4, "interior")
    solid(0, 5.5, 0, 18.6, 0.35, 14.6, "roof")
    solid(-6, 0, 4.5, 3, 1, 1.2, "desk")
    solid(6.8, 0, -4.5, 1.5, 2.2, 2, "cabinet")


def garage_and_compound():
    # West maintenance canopy: open north and east, another exit at rear.
    solid(-24, 5.5, 18, 16, 0.3, 12, "canopy")
    for x in (-31, -17):
        for z in (13, 23):
            solid(x, 0, z, 0.5, 5.5, 0.5, "post")
    solid(-24, 0, 23.5, 8, 4, 0.6, "bunker")
    solid(-26, 0, 18, 3, 2.5, 7, "vehicle")
    solid(-19, 0, 21, 2, 2.5, 3, "generator")
    # Supply side / risky watchtower landmark (no climbable staircase).
    solid(25, 0, 20, 8, 3, 4, "container")
    solid(16, 0, 22, 4, 8, 4, "tower")
    solid(16, 8, 22, 6, 0.5, 6, "canopy")
    for x, z, w, h, d, kind in [
        (-18, -4, 5, 1.1, 1, "sandbag"),
        (24, -9, 6, 1.1, 1, "sandbag"),
        (-17, 9, 4, 2, 3, "cargo"),
        (16, 12, 5, 2.5, 3, "generator"),
        (-5, 17, 5, 1.1, 1, "sandbag"),
        (5, 19, 4, 1.1, 1, "sandbag"),
        (-22, -19, 4, 2, 2, "cargo"),
        (29, -17, 3, 2.5, 3, "cargo"),
    ]:
        solid(x, 0, z, w, h, d, kind)


cliffs()
ridge()
starts()
command()
garage_and_compound()
SPAWNS = {
    "Alpha": [[x, z] for x in (-43, -47) for z in (-5, -1, 3, 5)],
    "Bravo": [[x, z] for x in (43, 46) for z in (-4, 0, 4, 6)],
    "neutral": [
        [-44, -5],
        [-43, 6],
        [43, -5],
        [43, 5],
        [-33, -17],
        [34, -17],
        [-35, 18],
        [35, 16],
        [-35, 26],
        [24, 28],
        [-26, 38],
        [-15, 37],
        [0, 37],
        [10, 34],
        [-6, 28],
        [-3, 23],
        [-12, 15],
        [12, 17],
        [-5, 3],
        [5, -2],
        [-15, -12],
        [8, -17],
        [28, -3],
        [-23, 1],
        [-24, -22],
        [32, -21],
        [-14, -38],
        [15, -39],
        [0, -36],
        [-3, -14],
    ],
}
MAP = dict(
    id="outpost",
    name="Outpost",
    version=1,
    enabled=True,
    team_respawns=False,
    boxes=BOXES,
    surfaces=SURFACES,
    spawns=SPAWNS,
    bounds=dict(bound_x=59.0, bound_z=53.0),
)
