from copy import deepcopy

import pytest
from sqlalchemy import func, select

from backend.app.casino import configuration, duels, settings
from backend.app.casino.games import crash, penalty, plinko
from backend.tests.conftest import sign_in
from backend.tests.test_casino_incremental import Predictable, prepare_tables, seed
from shared.casino_models import CasinoAccount, CasinoConfig, CasinoConfigVersion
from shared.errors import DomainError


def proposal(identity="draft-000000000001"):
    value = deepcopy(settings.DEFAULT_CONFIG)
    value["withdraw"]["denominator"] = 900
    return {
        "id": identity,
        "revision": 0,
        "base_version": 1,
        "value": value,
        "reason": "Изменить курс вывода",
    }


def test_preview_is_read_only_and_reports_exact_steps(database):
    with database.begin() as db:
        seed(db)
        request = proposal()
        preview = configuration.preview(db, request["value"], request["reason"], 1)
        assert preview["changes"] == [
            {"path": "withdraw.denominator", "before": 1000, "after": 900}
        ]
        assert preview["exchange_steps"] == {"deposit": 1, "withdraw": 900}
        assert db.get(CasinoConfig, 1).version == 1


def test_draft_retries_apply_once_and_preserve_version(database):
    with database.begin() as db:
        seed(db)
        request = proposal()
        first = configuration.save(db, "alice", request)
        assert configuration.save(db, "alice", request) == first
        assert db.get(CasinoConfig, 1).version == 1
        applied = configuration.apply(db, "alice", first["id"], 1)
        assert applied["version"] == 2
        assert configuration.apply(db, "alice", first["id"], 1) == applied
        assert db.scalar(select(func.count()).select_from(CasinoConfigVersion)) == 1
        settings.update(db, "alice", settings.DEFAULT_CONFIG, "Новая конфигурация")
        assert configuration.apply(db, "alice", first["id"], 1) == applied
        assert db.get(CasinoConfig, 1).version == 3
        assert db.get(CasinoConfigVersion, 2).value == request["value"]


def test_draft_concurrent_edit_and_concurrent_apply_rejected(database):
    with database.begin() as db:
        seed(db)
        first, second = proposal(), proposal("draft-000000000002")
        configuration.save(db, "alice", first)
        configuration.save(db, "alice", second)
        changed = deepcopy(first)
        changed["value"]["commission_bps"] = 600
        with pytest.raises(DomainError, match="другой вкладке"):
            configuration.save(db, "alice", changed)
        changed["revision"] = 1
        updated = configuration.save(db, "alice", changed)
        assert updated["revision"] == 2
        with pytest.raises(DomainError, match="Редакция"):
            configuration.apply(db, "alice", first["id"], 1)
        configuration.apply(db, "alice", first["id"], 2)
        with pytest.raises(DomainError, match="Другой администратор"):
            configuration.apply(db, "alice", second["id"], 1)


def test_invalid_probability_and_foreign_draft_rejected(database):
    with database.begin() as db:
        seed(db)
        request = proposal()
        configuration.save(db, "alice", request)
        with pytest.raises(DomainError, match="Чужой"):
            configuration.save(db, "other", {**request, "revision": 1})
        with pytest.raises(DomainError, match="автор"):
            configuration.apply(db, "other", request["id"], 1)
        request["value"]["math"]["penalty_defense"]["low"] = [20] * 4 + [21]
        with pytest.raises(DomainError, match="100%"):
            configuration.preview(db, request["value"], request["reason"], 1)


def test_configuration_endpoints_require_admin(client):
    _, headers = sign_in(client)
    for path in ("drafts", "versions", "versions/compare?from=1&to=2"):
        assert client.get(f"/api/casino/admin/{path}").status_code == 403
    for path in ("drafts", "settings/preview", "drafts/0000000000000000/apply"):
        assert client.post(f"/api/casino/admin/{path}", json={}, headers=headers).status_code == 403


@pytest.mark.parametrize("engine", [plinko, penalty])
@pytest.mark.parametrize("risk", [[], {}, True, 5])
def test_invalid_risk_is_domain_error(engine, risk):
    with pytest.raises(DomainError):
        engine.start(100, {"risk": risk}, Predictable())


def test_crash_strict_threshold_exact_boundary():
    threshold = 200
    accepted_samples = 97 * 2**52 // (threshold + 1)
    assert (
        crash.cashout_probability(threshold).numerator
        / crash.cashout_probability(threshold).denominator
        < 0.485
    )

    class Sample:
        def __init__(self, sample):
            self.sample = sample

        def below(self, size):
            return self.sample - 1

    assert crash.outcome(Sample(accepted_samples))["point"] > threshold
    assert crash.outcome(Sample(accepted_samples + 1))["point"] <= threshold


def test_duel_retry_survives_table_round_change(database):
    with database.begin() as db:
        prepare_tables(db)
        duels.ensure_tables(db)
        joined = duels.join(db, "alice", "dice-1000-0", {"request_id": "first-join-00000001"})
        payload = {
            "round_id": joined["round"]["id"],
            "action": "leave",
            "request_id": "leave-duel-00000001",
        }
        left = duels.command(db, "alice", "dice-1000-0", payload)
        second = duels.join(db, "alice", "dice-1000-0", {"request_id": "second-join-0000001"})
        assert second["round"]["id"] != joined["round"]["id"]
        assert duels.command(db, "alice", "dice-1000-0", payload) == left
        assert db.get(CasinoAccount, "alice").reserved == 1000
