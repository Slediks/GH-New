import os

from flask import Blueprint, g, has_request_context, request
from itsdangerous import URLSafeTimedSerializer
from redis import Redis
from sqlalchemy import select

from backend.app.arena import settings as policy
from backend.app.arena import grenade_settings
from backend.app.arena.config import DEFAULTS, EYE, RADIUS, SPEED, TICK, VERSION
from backend.app.arena.maps import DEFAULT_MAP, catalog, get_map
from backend.app.common.http import roles
from shared.arena_models import ArenaMatch, ArenaRoom, ArenaSeat
from shared.arena_map_models import ArenaMap
from shared.config import REDIS_URL
from shared.db import lock
from shared.errors import DomainError
from shared.models import User, now, uid

arena = Blueprint("arena", __name__)


def seats(db, room_id):
    return list(db.scalars(select(ArenaSeat).where(ArenaSeat.room_id == room_id)))


def public(room, members, available_maps=None):
    return dict(
        id=room.id,
        name=room.name,
        testRoom=bool(room.settings.get("_test")),
        mapName=(room.settings.get("_draft_map") or room.settings.get("_map") or {}).get("name"),
        mapAvailable=(room.settings.get("_draft_map") is not None or
                      room.settings.get("map_id", DEFAULT_MAP) in available_maps)
        if available_maps is not None else None,
        host_id=room.host_id,
        settings={"map_id": DEFAULT_MAP}
        | {k: v for k, v in room.settings.items() if not k.startswith("_")},
        status=room.status,
        match_id=room.match_id,
        players=[dict(id=s.user_id, name=s.name, team=s.team, ready=s.ready) for s in members],
    )


def settings(data):
    if not isinstance(data, dict):
        raise DomainError("Некорректные настройки")
    value = DEFAULTS | {k: v for k, v in data.items() if k in DEFAULTS}
    if "map_id" not in data and not any(m["id"] == DEFAULT_MAP for m in catalog()):
        available = catalog()
        if not available:
            raise DomainError("Нет опубликованных карт Arena", 409)
        value["map_id"] = available[0]["id"]
    get_map(value["map_id"], require_enabled=True)
    if value["mode"] not in ("elimination", "tdm", "dm"):
        raise DomainError("Неизвестный режим")
    for key, low, high in (
        ("size", 2 if value["mode"] == "dm" else 1, 10 if value["mode"] == "dm" else 5),
        ("rounds", 1, 15),
        ("kills", 5, 100),
        ("minutes", 2, 30),
    ):
        if type(value[key]) is not int or not low <= value[key] <= high:
            raise DomainError(f"{key}: допустимо {low}–{high}")
    if type(value["full"]) is not bool:
        raise DomainError("Полные команды: требуется да/нет")
    if value["mode"] == "dm":
        value["full"] = False
    return value


def check_start(config, members):
    if len(members) < 2 or not all(s.ready for s in members):
        raise DomainError("Нужны минимум два готовых участника")
    if config["mode"] != "dm":
        counts = [sum(s.team == team for s in members) for team in ("Alpha", "Bravo")]
        if min(counts) == 0 or (config["full"] and counts != [config["size"]] * 2):
            raise DomainError("Нужны обе команды; при включённом ограничении — полные")


@arena.get("/manifest")
def manifest():
    available = catalog()
    if not available:
        raise DomainError("Нет опубликованных карт Arena", 409)
    selected = DEFAULT_MAP if any(m["id"] == DEFAULT_MAP for m in available) else available[0]["id"]
    return make_manifest(policy.current(g.db), selected)


def make_manifest(rules, map_id=DEFAULT_MAP, world=None):
    from backend.app.arena import grenade_settings
    world = world if world is not None else get_map(map_id)
    config = rules["config"]
    return dict(
        policy=rules,
        version=VERSION,
        movement=config["movement"] | world["bounds"],
        map={k: world[k] for k in ("id", "name", "version")},
        maps=catalog(),
        definition=world.get("definition"),
        assets=world.get("assets"),
        playable=world.get("playable", []),
        excluded=world.get("excluded", []),
        bullet_boxes=world.get("bullet_boxes", world["boxes"]),
        surfaces=world.get("surfaces", []),
        boxes=world["boxes"],
        spawns=world["spawns"],
        weapons=config["weapons"],
        tick=TICK,
        speed=SPEED,
        radius=RADIUS,
        eye=EYE,
        grenades=(grenade_settings.current(g.db)["config"] if has_request_context()
                  else grenade_settings.defaults()),
    )


def _can_view_test_room(db, user, room):
    if user.role == "admin":
        return True
    from backend.app.arena.editor.permissions import can_edit_map
    from shared.arena_map_models import ArenaMap

    row = db.get(ArenaMap, room.settings.get("map_id"))
    return bool(row and can_edit_map(db, user, row))


@arena.get("/rooms")
def rooms():
    available_maps = {m["id"] for m in catalog()}
    records = g.db.scalars(
        select(ArenaRoom)
        .where(ArenaRoom.status != "closed")
        .order_by(ArenaRoom.created_at.desc())
        .limit(100)
    )
    return {
        "rooms": [
            public(r, seats(g.db, r.id), available_maps)
            for r in records
            if not r.settings.get("_test") or _can_view_test_room(g.db, g.user, r)
        ],
        "online": bool(Redis.from_url(REDIS_URL).get("gamehub:arena:alive")),
    }


@arena.post("/rooms")
def create():
    lock(g.db, User, g.user.id)
    if g.db.get(ArenaSeat, g.user.id):
        raise DomainError("Сначала покиньте текущую комнату", 409)
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        raise DomainError("Ожидается объект запроса")
    name = str(data.get("name", "Арена")).strip()[:60] or "Арена"
    rules = policy.current(g.db)
    requested = data.get("settings", {})
    if not isinstance(requested, dict):
        raise DomainError("Некорректные настройки")
    mode = requested.get("mode", "elimination") if isinstance(requested, dict) else "elimination"
    base = rules["config"]["modes"].get(mode, {})
    config = settings({k: base[k] for k in ("rounds", "kills", "minutes") if k in base} | requested)
    policy.available(rules["config"], config)
    room = ArenaRoom(id=uid(), host_id=g.user.id, name=name, settings=config, status="lobby")
    g.db.add(room)
    g.db.flush()
    member = ArenaSeat(
        user_id=g.user.id,
        room_id=room.id,
        name=g.user.login,
        team="neutral" if config["mode"] == "dm" else "Alpha",
        ready=False,
    )
    g.db.add(member)
    return public(room, [member])


@arena.get("/rooms/<room_id>")
def room_get(room_id):
    room = g.db.get(ArenaRoom, room_id)
    if not room:
        raise DomainError("Комната не найдена", 404)
    if room.settings.get("_test") and not _can_view_test_room(g.db, g.user, room):
        raise DomainError("Тестовая комната недоступна", 403)
    result = public(room, seats(g.db, room_id), {m["id"] for m in catalog()})
    match = g.db.get(ArenaMatch, room.match_id) if room.match_id else None
    result["result"] = match.result if match else None
    if match and room.status != "lobby":
        result["manifest"] = make_manifest(
            match.settings.get("_rules", dict(version=1, config=policy.defaults())),
            match.settings.get("map_id", DEFAULT_MAP),
            match.settings.get("_map"),
        )
    return result


@arena.post("/rooms/<room_id>/<action>")
def command(room_id, action):
    lock(g.db, User, g.user.id)
    room = lock(g.db, ArenaRoom, room_id)
    if not room or room.status == "closed":
        raise DomainError("Комната закрыта", 404)
    if room.settings.get("_test") and action != "leave" and not _can_view_test_room(g.db, g.user, room):
        raise DomainError("Тестовая комната недоступна", 403)
    members = seats(g.db, room.id)
    member = next((s for s in members if s.user_id == g.user.id), None)
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        raise DomainError("Ожидается объект запроса")
    if action == "join":
        if member:
            return public(room, members)
        if room.status != "lobby" or g.db.get(ArenaSeat, g.user.id):
            raise DomainError("Вход сейчас недоступен", 409)
        config = room.settings
        capacity = config["size"] * (1 if config["mode"] == "dm" else 2)
        if len(members) >= capacity:
            raise DomainError("Комната заполнена", 409)
        team = (
            "neutral"
            if config["mode"] == "dm"
            else min(("Alpha", "Bravo"), key=lambda t: sum(s.team == t for s in members))
        )
        member = ArenaSeat(
            user_id=g.user.id, room_id=room.id, name=g.user.login, team=team, ready=False
        )
        g.db.add(member)
        members.append(member)
    elif not member:
        raise DomainError("Вы не участник комнаты", 403)
    elif action == "presence":
        member.seen_at = now()
    elif action == "ticket":
        member.seen_at = now()
        return {
            "ticket": URLSafeTimedSerializer(os.environ["SECRET_KEY"], salt="arena").dumps(
                {"user": g.user.id, "room": room.id, "session": g.session.token}
            )
        }
    elif action == "leave":
        g.db.delete(member)
        members.remove(member)
        if not members:
            room.status = "closed"
        elif room.host_id == g.user.id:
            room.host_id = members[0].user_id
    elif action in ("ready", "team", "settings", "start", "close", "lobby"):
        if action in ("settings", "start", "close", "lobby") and room.host_id != g.user.id:
            raise DomainError("Действие доступно владельцу комнаты", 403)
        if action == "lobby" and room.status == "finished":
            room.status = "lobby"
            for s in members:
                s.ready = False
        elif room.status != "lobby":
            raise DomainError("Дождитесь завершения матча", 409)
        elif action == "ready":
            member.ready = data.get("ready") is True
        elif action == "team":
            team = data.get("team")
            if room.settings["mode"] == "dm" or team not in ("Alpha", "Bravo"):
                raise DomainError("Команда недоступна")
            if sum(s.team == team and s != member for s in members) >= room.settings["size"]:
                raise DomainError("Команда заполнена")
            member.team, member.ready = team, False
        elif action == "settings":
            if room.settings.get("_test"):
                raise DomainError("Настройки тестовой комнаты зафиксированы снимком")
            config = settings(data)
            policy.available(policy.current(g.db)["config"], config)
            if len(members) > config["size"] * (1 if config["mode"] == "dm" else 2):
                raise DomainError("Участников больше нового лимита")
            room.settings = config
            for index, s in enumerate(members):
                s.team = "neutral" if config["mode"] == "dm" else ("Alpha", "Bravo")[index % 2]
                s.ready = False
        elif action == "start":
            if not Redis.from_url(REDIS_URL).get("gamehub:arena:alive"):
                raise DomainError("Сервер Арены временно недоступен", 503)
            rules = policy.current(g.db)
            policy.available(rules["config"], room.settings)
            if not room.settings.get("_draft_map"):
                map_row = lock(g.db, ArenaMap, room.settings.get("map_id", DEFAULT_MAP))
                if not map_row or not map_row.enabled:
                    raise DomainError("Карта снята с публикации. Выберите другую карту.", 409)
            world = room.settings.get("_draft_map") or get_map(
                room.settings.get("map_id", DEFAULT_MAP), require_enabled=True
            )
            if room.settings["mode"] not in world.get("modes", ["elimination", "tdm", "dm"]):
                raise DomainError("Режим не поддерживается картой")
            if "spawn_records" in world:
                for team in ("neutral",) if room.settings["mode"] == "dm" else ("Alpha", "Bravo"):
                    available = sum(
                        s["team"] == team and room.settings["mode"] in s["modes"]
                        for s in world["spawn_records"]
                    )
                    required = sum(s.team == team for s in members)
                    if available < required:
                        raise DomainError(
                            f"Недостаточно стартов {team}: {available} для {required} игроков"
                        )
            check_start(room.settings, members)
            match = ArenaMatch(
                id=uid(),
                room_id=room.id,
                settings={k: v for k, v in room.settings.items() if k != "_draft_map"}
                | {"_rules": rules, "_map": world, "map_revision": world["version"],
                   "_grenades": grenade_settings.current(g.db)["config"]},
                roster=public(room, members)["players"],
                status="loading",
            )
            g.db.add(match)
            room.match_id, room.status = match.id, "loading"
        elif action == "close":
            room.status = "closed"
            for s in members:
                g.db.delete(s)
            members = []
    else:
        raise DomainError("Неизвестное действие")
    result = public(room, members)
    if action == "start":
        result["manifest"] = make_manifest(rules, room.settings.get("map_id", DEFAULT_MAP), world)
    return result


@arena.get("/history")
@roles("admin")
def history():
    page = request.args.get("page", 1, type=int)
    page = max(1, page or 1)
    records = g.db.scalars(
        select(ArenaMatch)
        .where(ArenaMatch.status == "finished")
        .order_by(ArenaMatch.created_at.desc())
        .offset((page - 1) * 25)
        .limit(26)
    ).all()
    return {
        "page": page,
        "has_more": len(records) > 25,
        "matches": [
            dict(
                id=m.id,
                settings={k: v for k, v in m.settings.items() if not k.startswith("_")}
                | dict(map_name=m.settings.get("_map", {}).get("name")),
                result=m.result or {},
                created_at=m.created_at,
                finished_at=m.finished_at,
                status=m.status,
            )
            for m in records[:25]
        ],
    }


@arena.get("/admin")
@roles("admin")
def admin_get():
    return policy.current(g.db) | dict(
        schema=dict(
            common=policy.COMMON,
            modes=policy.MODE,
            weapons=policy.WEAPON,
            recoil=policy.RECOIL,
            movement=policy.MOVING,
        )
    )


@arena.post("/admin")
@roles("admin")
def admin_save():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        raise DomainError("Ожидается объект")
    return policy.save(g.db, g.user.id, data.get("version"), data.get("config"))


@arena.get("/admin/grenades")
@roles("admin")
def grenade_admin_get():
    from backend.app.arena import grenade_settings

    return grenade_settings.current(g.db) | {"ranges": grenade_settings.RANGES}


@arena.post("/admin/grenades")
@roles("admin")
def grenade_admin_save():
    from backend.app.arena import grenade_settings

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise DomainError("Ожидается объект")
    return grenade_settings.save(g.db, g.user.id, data.get("version"), data.get("config"))


@arena.post("/admin/grenades/reset")
@roles("admin")
def grenade_admin_reset():
    from backend.app.arena import grenade_settings

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise DomainError("Ожидается объект")
    return grenade_settings.save(g.db, g.user.id, data.get("version"), None, reset=True)


@arena.get("/profile")
def player_profile():
    from backend.app.arena.statistics import profile

    return profile(g.db, g.user.id)
