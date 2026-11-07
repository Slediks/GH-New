"""Versioned defaults; distances in metres, durations in seconds."""

VERSION = 3
TICK = 1 / 30
HEALTH = 100
SPEED = 5.5
RADIUS = 0.36
EYE = 1.62
RESPAWN = 3
PROTECTION = 2
RECONNECT = 25
REWIND = 0.2
MOVEMENT = dict(
    walk_speed=SPEED,
    crouch_speed=3.1,
    acceleration=45.0,
    deceleration=55.0,
    air_acceleration=14.0,
    jump_force=7.2,
    gravity=21.0,
    terminal_speed=24.0,
    jump_cooldown=0.22,
    radius=RADIUS,
    standing_height=1.88,
    crouch_height=1.18,
    standing_eye=EYE,
    crouch_eye=1.02,
    step_height=0.28,
    max_slope=45.0,
    bound_x=23.0,
    bound_z=19.0,
)
WEAPONS = {
    "pistol": dict(
        name="Пистолет",
        damage=26,
        interval=0.28,
        magazine=12,
        reserve=72,
        reload=1.35,
        spread=0.006,
        pellets=1,
        head=2,
        reach=65,
        recoil=0.018,
    ),
    "rifle": dict(
        name="Винтовка",
        damage=24,
        interval=0.11,
        magazine=30,
        reserve=150,
        reload=2.1,
        spread=0.013,
        pellets=1,
        head=2,
        reach=85,
        recoil=0.012,
    ),
    "shotgun": dict(
        name="Дробовик",
        damage=13,
        interval=0.85,
        magazine=6,
        reserve=36,
        reload=2.5,
        spread=0.075,
        pellets=8,
        head=1.4,
        reach=24,
        recoil=0.055,
    ),
    "sniper": dict(
        name="Снайперская",
        damage=80,
        interval=1.3,
        magazine=5,
        reserve=25,
        reload=2.8,
        spread=0.001,
        pellets=1,
        head=2,
        reach=100,
        recoil=0.065,
    ),
}
DEFAULTS = dict(map_id="depot_07", mode="elimination", size=3, full=False, rounds=5, kills=30, minutes=8)

# Visual profiles never determine damage. Server spread/heat remains authoritative.
for name, vertical, horizontal, recovery, kick in (
    ("pistol", 0.018, 0.004, 14.0, 0.045),
    ("rifle", 0.012, 0.003, 10.0, 0.032),
    ("shotgun", 0.032, 0.006, 8.0, 0.085),
    ("sniper", 0.04, 0.004, 7.0, 0.095),
):
    WEAPONS[name]["recoil_profile"] = dict(
        vertical=vertical,
        horizontal=horizontal,
        recovery=recovery,
        kick=kick,
        accumulation=0.13,
        cap=3.0,
    )

# Linear damage profiles, in metres; no weapon-specific ray cutoff.
for weapon, start, end, minimum in (
    ("pistol", 12, 40, 0.35),
    ("rifle", 20, 55, 0.45),
    ("shotgun", 6, 28, 0.08),
    ("sniper", 40, 90, 0.8),
):
    WEAPONS[weapon].pop("reach")
    WEAPONS[weapon].update(
        full_damage_distance=start,
        falloff_end_distance=end,
        minimum_damage_multiplier=minimum,
        scope_fov=30 if weapon == "sniper" else 0,
    )
