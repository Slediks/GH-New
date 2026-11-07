#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
apps=(nginx backend arena casino-worker simulation games)
archive=offline/images/gamehub-images.tar

dc() { docker compose "$@"; }
version() { sed -n 's/^GAMEHUB_VERSION=//p' .env | tail -n 1; }
wait_service() {
  local service="$1" id state deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    id="$(dc ps -q "$service")"
    if [[ -n "$id" ]]; then
      state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
      [[ "$state" == healthy || "$state" == running ]] && return 0
      [[ "$state" == unhealthy || "$state" == exited ]] && { echo "$service is $state" >&2; return 1; }
    fi
    sleep 2
  done
  echo "Timeout waiting for $service" >&2
  return 1
}
resume_apps() {
  dc up -d --no-deps backend arena casino-worker simulation games
  wait_service backend
  wait_service arena
  dc up -d --no-deps nginx
  wait_service nginx
}
start_stack() {
  [[ -f .env ]] || { echo 'Missing .env. Run install first.' >&2; return 1; }
  dc up -d --no-deps postgres redis
  wait_service postgres
  wait_service redis
  dc run --rm --no-deps migrate
  resume_apps
  echo "GameHub: http://localhost:$(sed -n 's/^GAMEHUB_PORT=//p' .env | tail -n 1)"
}
load_images() {
  [[ -f "$archive" ]] || { echo "Missing $archive" >&2; return 1; }
  (cd offline/images && sha256sum -c gamehub-images.tar.sha256)
  docker load -i "$archive"
  docker run --rm --network none -v "$PWD:/package:ro" python:3.11-slim python -c 'import hashlib,json,pathlib,sys; root=pathlib.Path("/package"); files=json.loads((root/"offline/manifest.json").read_text(encoding="utf-8-sig"))["files"]; bad=[name for name,digest in files.items() if not (root/name).is_file() or hashlib.sha256((root/name).read_bytes()).hexdigest()!=digest]; print("Package integrity:", "OK" if not bad else bad[:5]); sys.exit(bool(bad))'
}
backup() {
  local target="${1:-backups/gamehub-$(version)-$(date +%Y%m%d-%H%M%S)}" id schema
  [[ ! -e "$target" ]] || { echo "Backup already exists: $target" >&2; return 1; }
  mkdir -p "$target"
  chmod 700 "$target"
  target="$(cd "$target" && pwd)"
  trap resume_apps EXIT
  dc stop "${apps[@]}"
  id="$(dc ps -q postgres)"
  [[ -n "$id" ]] || { echo 'PostgreSQL is not running.' >&2; return 1; }
  docker exec "$id" pg_dump -U gamehub -d gamehub -Fc -f /tmp/gamehub-backup.dump
  docker cp "$id:/tmp/gamehub-backup.dump" "$target/database.dump"
  docker exec "$id" rm -f /tmp/gamehub-backup.dump
  docker run --rm --network none -v gamehub_game_files:/data:ro -v "$target:/backup" nginx:1.27-alpine tar -czf /backup/files.tar.gz -C /data .
  cp .env "$target/config.env"
  cp deploy/games.conf "$target/games.conf"
  schema="$(docker exec "$id" psql -U gamehub -d gamehub -Atc 'SELECT version_num FROM alembic_version LIMIT 1')"
  printf '{"version":"%s","schema":"%s","created":"%s"}\n' "$(version)" "$schema" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$target/manifest.json"
  (cd "$target" && sha256sum database.dump files.tar.gz config.env games.conf > SHA256SUMS)
  resume_apps
  trap - EXIT
  echo "$target"
}
restore() {
  local target="${1:?Specify backup directory}" id
  [[ "${CONFIRM_RESTORE:-}" == YES ]] || { echo 'Set CONFIRM_RESTORE=YES to replace current data.' >&2; return 1; }
  target="$(cd "$target" && pwd)"
  (cd "$target" && sha256sum -c SHA256SUMS)
  previous="$(docker run --rm --network none -v "$target:/backup:ro" python:3.11-slim python -c 'import json; print(json.load(open("/backup/manifest.json"))["version"])')"
  docker image inspect "gamehub-backend:$previous" "gamehub-frontend:$previous" >/dev/null
  if [[ "${SKIP_SAFETY_BACKUP:-}" != YES ]]; then backup; fi
  dc stop "${apps[@]}"
  id="$(dc ps -q postgres)"
  docker cp "$target/database.dump" "$id:/tmp/gamehub-restore.dump"
  docker exec "$id" pg_restore -U gamehub -d gamehub --clean --if-exists --no-owner --no-privileges /tmp/gamehub-restore.dump
  docker exec "$id" rm -f /tmp/gamehub-restore.dump
  docker run --rm --network none -v gamehub_game_files:/data -v "$target:/backup:ro" nginx:1.27-alpine sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/files.tar.gz -C /data'
  cp "$target/config.env" .env
  cp "$target/games.conf" deploy/games.conf
  start_stack
}
build_images() {
  local tag="$1"; shift
  docker build --pull=false --network none "$@" -f deploy/Dockerfile.backend.offline -t "gamehub-backend:$tag" .
  docker build --pull=false --network none "$@" -f deploy/Dockerfile.frontend.offline -t "gamehub-frontend:$tag" .
}

action="${1:?Usage: scripts/offline.sh install|start|stop|status|logs|backup|restore|update|rollback|check}"
shift
docker version --format '{{.Server.Version}}' >/dev/null
docker compose version >/dev/null
case "$action" in
  load-images) load_images ;;
  install)
    load_images
    if [[ ! -f .env ]]; then
      cp .env.example .env
      password="$(docker run --rm --network none python:3.11-slim python -c 'import secrets; print(secrets.token_hex(32))')"
      secret="$(docker run --rm --network none python:3.11-slim python -c 'import secrets; print(secrets.token_hex(32))')"
      sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$password/; s/^SECRET_KEY=.*/SECRET_KEY=$secret/" .env
      chmod 600 .env
      echo 'Configure the existing LAN authentication API in .env before user login.'
    fi
    mkdir -p backups
    start_stack ;;
  start) start_stack ;;
  stop) dc stop "${apps[@]}" ;;
  status) echo "GameHub version: $(version)"; dc ps ;;
  logs) dc logs --tail 150 ;;
  backup) backup "${1:-}" ;;
  restore|rollback) restore "${1:?Specify backup directory}" ;;
  update)
    old="$(version)"
    next="${1:-local-$(date +%Y%m%d-%H%M%S)}"
    [[ "$next" != "$old" ]] || { echo 'New version must differ from current version.' >&2; exit 1; }
    docker image inspect "gamehub-backend:$old" "gamehub-frontend:$old" >/dev/null
    build_images "$next"
    saved="$(backup | tail -n 1)"
    dc stop "${apps[@]}"
    export GAMEHUB_VERSION="$next"
    if dc run --rm --no-deps migrate && dc up -d --no-deps --force-recreate backend arena casino-worker simulation games && wait_service backend && wait_service arena && dc up -d --no-deps --force-recreate nginx && wait_service nginx; then
      sed -i "s/^GAMEHUB_VERSION=.*/GAMEHUB_VERSION=$next/" .env
      echo "Updated to $next. Backup: $saved"
    else
      echo "Update failed. Restoring $saved" >&2
      unset GAMEHUB_VERSION
      CONFIRM_RESTORE=YES SKIP_SAFETY_BACKUP=YES restore "$saved"
      exit 1
    fi ;;
  check) (cd offline/images && sha256sum -c gamehub-images.tar.sha256); build_images "offline-check-$(date +%Y%m%d%H%M%S)" --no-cache ;;
  *) echo "Unknown action: $action" >&2; exit 2 ;;
esac
