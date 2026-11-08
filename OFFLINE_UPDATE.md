# GameHub без интернета: обновление исходников

Работайте в установленном каталоге GameHub. Меняйте файлы `frontend/`, `backend/`, `shared/`, `simulation/`, `deploy/` и миграции обычным редактором. Для сборки через Docker Git, Node.js и Python на хосте не нужны. Для прямой работы с исходниками доступны локальные наборы пакетов ниже.

```powershell
.\scripts\offline.ps1 update
```

Команда локально собирает новые backend/frontend-образы без сети, присваивает версию `local-YYYYMMDD-HHMMSS`, создаёт полную резервную копию, останавливает приложения, запускает миграции, пересоздаёт только приложения и проверяет их здоровье. PostgreSQL и постоянные тома не удаляются. При сбое выполняется восстановление резервной копии и прежней версии; ошибка остаётся видимой в выводе команды.

Для явной новой локальной версии: `.\scripts\offline.ps1 update -Version local-custom-1`. Для проверки сборки с пустым Docker build cache: `.\scripts\offline.ps1 check -Clean`. Обычное обновление может использовать безопасный локальный кеш для скорости.

На Linux: `bash scripts/offline.sh update` или `bash scripts/offline.sh update local-custom-1`.

При изменении `frontend/package-lock.json` или `requirements.lock` новые зависимости должны уже присутствовать в `offline/npm/cache` или `offline/python/wheels`. На полностью изолированной машине нельзя добавить отсутствующий пакет из публичного registry. Новый релиз должен поставлять обновлённый локальный набор зависимостей. Изменение кода с существующими зависимостями пересобирается на целевой машине без внешней подготовки.

## Новый готовый offline-релиз

1. Распакуйте новый пакет рядом со старым. Это каталог файлов, не второй стенд; Compose-проект по-прежнему один (`gamehub`, порт 8080).
2. В старом каталоге выполните `offline.ps1 backup`. Сохраните старый каталог до завершения проверки.
3. В новом каталоге выполните `offline.ps1 load-images`: команда сначала проверяет неизменность файлов готового пакета.
4. Скопируйте действующий `.env` из старого каталога в новый, не заменяя его `.env.example`. Если `deploy/games.conf` менялся вручную, перенесите эти изменения. Сопоставьте и перенесите собственные правки исходников в новый каталог до сборки.
5. Выполните `offline.ps1 update -Version <новая-версия>`. Новая команда использует те же именованные Docker-тома, делает свежий backup и пересоздаёт тот же Compose-проект.
6. Проверьте `offline.ps1 status`, вход, Arena и редактор. После этого считайте новый каталог рабочим; старый оставьте для отката до истечения срока хранения копий.

На Linux те же шаги выполняются через `bash scripts/offline.sh`. Перед обновлением продумайте обслуживание активных матчей и ставок. Не используйте `docker compose down -v`.

Пакет релиза создаётся на машине подготовки командой `scripts/prepare-offline.ps1`; только она может потребовать получить новые зависимости при изменении lockfile. На целевой машине `vendor-deps.ps1` не запускается.

## Frontend без интернета на Windows

Используйте установленный Node 22 и npm 10 или 11 на Windows x64. Из корня распакованного GH-New или офлайн-пакета:

```powershell
cd frontend
npm ci --include=optional --offline --cache ../offline/npm/cache --no-audit --no-fund
npm run build
cd ..
```

Пакеты, включая нативные `esbuild` и `rollup` для Windows, лежат в `offline/npm/cache`. Установка не использует глобальный npm cache или registry. Для Linux/amd64 те же команды работают с Node 22 и npm 10; кэш содержит Linux-пакеты для Docker-сборки.

## Backend без интернета на Windows

Используйте Python 3.11 x64. Из корня проекта:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --no-index --find-links offline/python/wheels -r requirements.lock
.\.venv\Scripts\python.exe -m pytest backend/tests/test_arena_creator_access.py -q
```

В `offline/python/wheels` находятся все версии из `requirements.lock`, их транзитивные зависимости и готовые нативные wheels для Windows и Linux/amd64. Для Linux создайте среду командой `python3.11 -m venv .venv` и используйте `./.venv/bin/python`. `gunicorn` запускается в Linux-контейнере; для полного стека на Windows используйте Docker. Проверка файла набора и lockfile: `./scripts/dependency-manifest.ps1 -Verify`.
