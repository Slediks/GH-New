"""Arena content permissions; role and ownership are checked on every request."""

from sqlalchemy import select

from shared.arena_map_models import ArenaMap, ArenaMapEditor
from shared.errors import DomainError
from shared.models import User


def can_edit_map(db, user: User, row: ArenaMap) -> bool:
    if user.role == "admin":
        return True
    if user.role != "author":
        return False
    if row.owner_user_id == user.id:
        return True
    return db.get(ArenaMapEditor, (row.id, user.id)) is not None


def can_manage_map_access(user: User, row: ArenaMap) -> bool:
    return user.role == "admin" or (user.role == "author" and row.owner_user_id == user.id)


def require_map(db, user: User, identity: str) -> ArenaMap:
    row = db.get(ArenaMap, identity)
    if not row or not can_edit_map(db, user, row):
        raise DomainError("Карта недоступна для редактирования", 403)
    return row


def require_owner_or_admin(user: User, owner_user_id: str):
    if user.role != "admin" and not (user.role == "author" and user.id == owner_user_id):
        raise DomainError("Нет прав на этот источник", 403)


def public_owner(db, owner_user_id: str) -> str:
    user = db.get(User, owner_user_id)
    return user.login if user else "Недоступный пользователь"


def visible_maps(db, user: User):
    if user.role == "admin":
        return db.scalars(select(ArenaMap).order_by(ArenaMap.updated_at.desc())).all()
    return db.scalars(select(ArenaMap).outerjoin(
        ArenaMapEditor,
        (ArenaMapEditor.map_id == ArenaMap.id) & (ArenaMapEditor.user_id == user.id),
    ).where(
        (ArenaMap.owner_user_id == user.id) | (ArenaMapEditor.user_id == user.id)
    ).order_by(ArenaMap.updated_at.desc())).all()
