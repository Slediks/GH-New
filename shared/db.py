from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from shared.config import DATABASE_URL, DEFAULT_RULES
from shared.models import Setting

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def rules(db: Session) -> dict:
    record = db.get(Setting, "rules")
    return DEFAULT_RULES | (record.value if record else {})


def lock(db: Session, model: type, identity: object):
    """SELECT FOR UPDATE; callers must retain their transaction through all writes."""
    primary_key = next(iter(model.__table__.primary_key))
    return db.scalar(select(model).where(primary_key == identity).with_for_update())
