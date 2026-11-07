"""Create local-only development credentials without printing or committing secrets."""

import secrets
from pathlib import Path

target = Path(".env")
if target.exists():
    raise SystemExit(".env already exists; no changes made")
target.write_text(
    f"POSTGRES_PASSWORD={secrets.token_hex(24)}\nSECRET_KEY={secrets.token_hex(32)}\n"
    "APP_ENV=development\nAUTH_ADAPTER=mock\n"
    "COOKIE_SECURE=false\nGAMEHUB_PORT=8080\nGAMEHUB_VERSION=2.0\n",
    encoding="utf-8",
)
print("Created development .env with explicit mock authentication")
