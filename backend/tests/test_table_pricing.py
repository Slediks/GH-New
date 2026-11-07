from copy import deepcopy

import pytest
from sqlalchemy import select

from backend.app.casino import duels, poker, table_pricing
from backend.tests.conftest import sign_in
from backend.tests.test_casino_incremental import prepare_tables
from shared.casino_models import CasinoAccount, CasinoConfig, CasinoLedger, CasinoRound
from shared.casino_tables import CasinoTable
from shared.errors import DomainError
from shared.models import AuditLog, User


def test_fixed_entry_freezes_waiting_price_and_ignores_global_limits_and_client_amount(database):
    with database.begin() as db:
        prepare_tables(db)
        duels.ensure_tables(db)
        table = db.get(CasinoTable, "durak-1000-0")
        table.pricing = {"mode": "fixed", "fixed_price": 1234}
        config = db.get(CasinoConfig, 1)
        value = deepcopy(config.value)
        value["games"]["durak"].update(minimum=99999, maximum=100000)
        config.value = value
        payload = {"request_id": "entry-fixed-00001", "amount": "0.01", "pricing_version": 1}
        joined = duels.join(db, "alice", table.id, payload)
        record = db.get(CasinoRound, joined["round"]["id"])
        frozen = deepcopy(record.rules)
        assert db.get(CasinoAccount, "alice").reserved == 1234
        table.pricing = {"mode": "fixed", "fixed_price": 5678}
        table.pricing_version = 2
        assert duels.join(db, "alice", table.id, payload) == joined
        assert duels.view(db, table, "alice")["stake"] == 1234
        db.add(
            CasinoAccount(
                id="bob", label="Bob", is_bot=True, available=100000, reserved=0, at_table=0
            )
        )
        db.flush()
        duels.join(db, "bob", table.id, {"request_id": "entry-fixed-00002", "pricing_version": 1})
        assert record.status == "playing" and record.rules == frozen
        assert {s.stake for s in duels.seats(db, record)} == {1234}
        record.state = {"winner": None, "done": True, "reason": "Проверка возврата"}
        participants = duels.seats(db, record)
        duels.settle(db, record, participants, duels.accounts(db, participants))
        assert duels.view(db, table, "alice")["stake"] == 5678
        with pytest.raises(DomainError, match="Цена стола изменилась"):
            duels.join(
                db, "alice", table.id, {"request_id": "entry-fixed-00003", "pricing_version": 1}
            )
        duels.join(db, "alice", table.id, {"request_id": "entry-fixed-00003", "pricing_version": 2})
        assert db.get(CasinoAccount, "alice").reserved == 5678
        log = db.scalars(select(CasinoLedger).where(CasinoLedger.kind == "reserve")).all()
        assert len(log) == 3 and log[-1].details["table_id"] == table.id


def test_legacy_pending_round_keeps_reserved_price_without_rewriting_history(database):
    with database.begin() as db:
        prepare_tables(db)
        duels.ensure_tables(db)
        table = db.get(CasinoTable, "dice-1000-0")
        joined = duels.join(db, "alice", table.id, {"request_id": "legacy-entry-0001"})
        record = db.get(CasinoRound, joined["round"]["id"])
        old = deepcopy(record.rules)
        old.pop("_table_pricing")
        record.rules = old
        table.pricing = {"mode": "fixed", "fixed_price": 5000}
        table.pricing_version = 2
        assert table_pricing.effective(db, table) == {
            "mode": "fixed",
            "fixed_price": 1000,
            "version": 0,
        }
        assert record.rules == old


def test_variable_buyin_uses_table_range_and_is_idempotent(database):
    with database.begin() as db:
        prepare_tables(db)
        poker.ensure_tables(db)
        table = db.get(CasinoTable, "holdem-1000-0")
        table.pricing = table_pricing.parse_update(
            table, {"mode": "variable", "min_bet": "500.01", "max_bet": "800"}
        )
        with pytest.raises(DomainError, match="диапазона"):
            poker.join(db, "alice", table.id, {"request_id": "variable-entry-001", "amount": "400"})
        payload = {"request_id": "variable-entry-002", "amount": "500.01", "pricing_version": 1}
        first = poker.join(db, "alice", table.id, payload)
        assert poker.join(db, "alice", table.id, payload) == first
        assert db.get(CasinoAccount, "alice").at_table == 50001
        assert first["pricing"]["mode"] == "variable"


@pytest.mark.parametrize("value", ["0", "-1", "1.001", "NaN", "1e2", 1.2, "1000000.01"])
def test_bad_prices_rejected(value):
    table = CasinoTable(
        game="dice", stake=1000, pricing={"mode": "fixed", "fixed_price": 1000}, pricing_version=1
    )
    with pytest.raises(DomainError):
        table_pricing.parse_update(table, {"mode": "fixed", "fixed_price": value})


def test_admin_price_edit_requires_role_reason_and_fresh_version(client, database):
    with database.begin() as db:
        prepare_tables(db)
        duels.ensure_tables(db)
    user, headers = sign_in(client, "pricing-admin")
    data = {
        "table_id": "dice-1000-0",
        "version": 1,
        "enabled": True,
        "reason": "Новая цена",
        "pricing": {"mode": "fixed", "fixed_price": "50.25"},
    }
    assert client.post("/api/casino/admin/table", json=data, headers=headers).status_code == 403
    with database.begin() as db:
        db.get(User, user["id"]).role = "admin"
    assert (
        client.post(
            "/api/casino/admin/table", json={**data, "reason": ""}, headers=headers
        ).status_code
        == 400
    )
    assert client.post("/api/casino/admin/table", json=data, headers=headers).status_code == 200
    assert client.post("/api/casino/admin/table", json=data, headers=headers).status_code == 409
    with database.begin() as db:
        table = db.get(CasinoTable, data["table_id"])
        assert table.pricing["fixed_price"] == 5025 and table.pricing_version == 2
        audit = db.scalar(select(AuditLog).where(AuditLog.action == "casino.table"))
        assert audit.details["before"]["pricing"]["fixed_price"] == 1000
        assert audit.details["after"]["pricing"]["fixed_price"] == 5025
