import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from shared.models import Base


@pytest.fixture(autouse=True)
def arena_publications(request, monkeypatch):
    if not request.node.path.name.startswith("test_arena"):
        return
    factory = request.getfixturevalue("database")
    import backend.app.arena.maps
    from backend.app.arena.editor.bootstrap import install

    monkeypatch.setattr(backend.app.arena.maps, "SessionLocal", factory)
    with factory.begin() as db:
        install(db)


@pytest.fixture
def database(monkeypatch, tmp_path):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("AUTH_ADAPTER", "mock")
    import backend.app
    import backend.app.games.service

    monkeypatch.setattr(backend.app, "SessionLocal", factory)
    monkeypatch.setattr(backend.app.games.service, "DATA_DIR", tmp_path)
    yield factory
    engine.dispose()


@pytest.fixture
def client(database):
    from backend.app import create_app

    app = create_app({"TESTING": True})
    return app.test_client()


def sign_in(client, login="alice"):
    csrf = client.get("/api/auth/session").json["csrf"]
    result = client.post("/api/auth/login", json={"login": login}, headers={"X-CSRF-Token": csrf})
    assert result.status_code == 200, result.json
    return result.json["user"], {"X-CSRF-Token": result.json["csrf"]}


@pytest.fixture
def postgres_database():
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to a disposable PostgreSQL database")
    engine = create_engine(url, pool_size=16, max_overflow=16)
    # Explicitly refuse the production database name to avoid destructive test setup.
    if not engine.url.database.endswith("_test"):
        raise RuntimeError("TEST_DATABASE_URL database name must end with _test")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    Base.metadata.drop_all(engine)
    engine.dispose()
