"""Administrative CLI. Admin assignment requires an existing external-auth profile."""

import argparse

from sqlalchemy import select

from backend.app.admin.service import audit
from shared.db import SessionLocal
from shared.models import User


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["seed", "admin"])
    parser.add_argument("login", nargs="?")
    args = parser.parse_args()
    if args.command == "seed":
        from backend.seed import seed

        seed()
    else:
        with SessionLocal.begin() as db:
            users = db.scalars(
                select(User).where(User.login == args.login, User.external_id != "system:demo")
            ).all()
            if len(users) != 1:
                raise SystemExit(
                    "Нужен уникальный локальный профиль после успешного входа через API"
                )
            users[0].role = "admin"
            audit(db, users[0].id, "bootstrap_admin", {"login": args.login})
        print("Роль администратора назначена")


if __name__ == "__main__":
    main()
