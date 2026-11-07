"""Migrate deployment keys without printing or changing authentication secrets."""
from pathlib import Path

path = Path('.env')
if not path.exists():
    raise SystemExit('No .env; create it from .env.example.')
lines = path.read_text(encoding='utf-8-sig').splitlines()
values = dict(line.split('=', 1) for line in lines if '=' in line and not line.lstrip().startswith('#'))
port = values.get('GAMEHUB_PORT', values.get('APP_PORT', '8080'))
replace = {'GAME_ORIGIN', 'GAMES_PORT', 'APP_PORT', 'GAMEHUB_PORT', 'GAMEHUB_VERSION'}
kept = [line for line in lines if line.split('=', 1)[0] not in replace]
kept += [f'GAMEHUB_PORT={port}', 'GAMEHUB_VERSION=2.0']
path.write_text('\n'.join(kept)+'\n', encoding='utf-8')
print('Updated deployment keys. Authentication settings and secrets preserved.')
