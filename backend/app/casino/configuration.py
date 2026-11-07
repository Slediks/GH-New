"""Administrative proposals, mathematical preview and immutable version comparison."""

from copy import deepcopy

from backend.app.admin.service import audit
from backend.app.casino import settings
from backend.app.casino.games.registry import ENGINES
from backend.app.casino.money import exchange_amount
from backend.app.casino.published import rules
from shared.casino_config_drafts import CasinoConfigDraft
from shared.casino_models import CasinoConfigVersion
from shared.db import lock
from shared.errors import DomainError
from shared.models import now


def changes(before, after, path=""):
    result = []
    for key in sorted(set(before) | set(after)):
        old, new = before.get(key), after.get(key)
        label = f"{path}.{key}" if path else key
        if isinstance(old, dict) and isinstance(new, dict):
            result.extend(changes(old, new, label))
        elif old != new:
            result.append({"path": label, "before": old, "after": new})
    return result


def serialize(draft):
    return {
        key: getattr(draft, key)
        for key in (
            "id",
            "actor_id",
            "base_version",
            "revision",
            "value",
            "reason",
            "applied_version",
            "created_at",
            "updated_at",
        )
    }


def preview(db, value, reason, base_version):
    settings.validate(value, reason)
    current = settings.config(db)
    if type(base_version) is not int or base_version != current.version:
        raise DomainError(
            "Настройки изменены другим администратором. Сравните версии и подготовьте новый черновик.",
            409,
        )
    return {
        "base_version": current.version,
        "changes": changes(current.value, value),
        "exchange_steps": {
            direction: exchange_amount(0, value[direction])[2]
            for direction in ("deposit", "withdraw")
        },
        "rules": {game: rules(game, value, current.version + 1) for game in ENGINES},
    }


def save(db, actor, payload):
    # Config lock serializes simultaneous creation of the same draft ID too.
    current = settings.config(db, for_update=True)
    identity, revision = payload.get("id"), payload.get("revision")
    if not isinstance(identity, str) or not 16 <= len(identity) <= 64 or type(revision) is not int:
        raise DomainError("Требуются идентификатор и редакция черновика")
    value, reason = payload.get("value"), payload.get("reason")
    settings.validate(value, reason)
    base = payload.get("base_version")
    if type(base) is not int or base != current.version:
        raise DomainError("Базовая версия устарела. Обновите настройки и сравните изменения.", 409)
    draft = lock(db, CasinoConfigDraft, identity)
    if draft:
        if draft.actor_id != actor:
            raise DomainError("Чужой черновик нельзя изменять", 403)
        if draft.applied_version is not None:
            raise DomainError("Черновик уже применён; создайте новый", 409)
        if (
            draft.revision == revision + 1
            and draft.value == value
            and draft.reason == reason.strip()[:1000]
            and draft.base_version == base
        ):
            return serialize(draft)
        if draft.revision != revision or draft.base_version != base:
            raise DomainError(
                "Черновик изменён в другой вкладке. Загрузите актуальную редакцию.", 409
            )
        draft.revision += 1
        draft.value, draft.reason = deepcopy(value), reason.strip()[:1000]
        draft.updated_at = now()
    else:
        if revision != 0:
            raise DomainError("Черновик не найден", 404)
        draft = CasinoConfigDraft(
            id=identity,
            actor_id=actor,
            base_version=base,
            revision=1,
            value=deepcopy(value),
            reason=reason.strip()[:1000],
        )
        db.add(draft)
    db.flush()
    audit(
        db,
        actor,
        "casino.draft.saved",
        {"id": draft.id, "revision": draft.revision, "base_version": draft.base_version},
    )
    return serialize(draft)


def apply(db, actor, identity, revision):
    current = settings.config(db, for_update=True)
    draft = lock(db, CasinoConfigDraft, identity)
    if not draft:
        raise DomainError("Черновик не найден", 404)
    if draft.actor_id != actor:
        raise DomainError("Применить черновик может его автор", 403)
    if type(revision) is not int or draft.revision != revision:
        raise DomainError("Редакция черновика изменилась. Повторите предпросмотр.", 409)
    if draft.applied_version is not None:
        applied = db.get(CasinoConfigVersion, draft.applied_version)
        return {"version": applied.id, "value": applied.value}
    if draft.base_version != current.version:
        raise DomainError(
            "Другой администратор уже применил изменения. Требуется новый черновик.", 409
        )
    if not changes(current.value, draft.value):
        raise DomainError("В черновике нет изменений")
    difference = changes(current.value, draft.value)
    updated = settings.update(db, actor, draft.value, draft.reason)
    draft.applied_version, draft.updated_at = updated.version, now()
    db.flush()
    audit(
        db,
        actor,
        "casino.config.applied",
        {
            "draft": draft.id,
            "revision": draft.revision,
            "version": updated.version,
            "changes": difference,
            "reason": draft.reason,
        },
    )
    return {"version": updated.version, "value": updated.value}
