# GameHub

Автономная поставка и пересборка без интернета: [установка](OFFLINE_INSTALL.md), [обновление](OFFLINE_UPDATE.md), [резервные копии](BACKUP_RESTORE.md), [откат](ROLLBACK.md).

Редактор карт Arena: [инструкция администратора, архитектура и проверки](docs/arena-map-editor.md).
Пользовательские 3D-модели: [Custom Asset Manager](docs/arena-custom-assets.md).

**Текущая рабочая тестовая установка:** HTTP `:8080`, Compose-проект `gamehub`,
версия образов `3.1.1`. С 11.10.2026 разработка и проверки выполняются на ней;
отдельный стенд `18080` больше не используется. Существующие данные сохраняются.
См. [порядок обновления и резервная копия](docs/deployment-8080.md).

Портал HTML-игр и общая футбольная трансляция для локальной сети. React + TypeScript,
Flask, PostgreSQL, Redis, отдельный Python-симулятор и nginx. Все ресурсы работают
локально. Очки виртуальные: покупок, вывода и переводов нет.

Готовый автономный архив публикуется отдельно в [GitHub Releases](https://github.com/Slediks/GH-New/releases).
Его установку и пересборку исходников без интернета описывает [OFFLINE_INSTALL.md](OFFLINE_INSTALL.md).
Архив образов не хранится в Git history; локальные npm cache и Python wheels входят в исходный репозиторий.

Футбол 3.0: персональные футболисты, сезоны Лиги чемпионов, ставки 1X2 и полноэкранный просмотр. [Правила, источники составов и сопровождение](docs/football-seasons.md).

## Быстрый запуск для разработки

Нужны Docker Engine с Compose v2 и Python 3.11+ для генерации локального `.env`.

```bash
python scripts/dev_env.py
docker compose -f compose.yaml -f compose.build.yaml build backend nginx
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker pull nginx:1.27-alpine
docker compose up -d
```

Откройте **http://<IP-компьютера>:8080** с любого компьютера локальной сети.
На самом сервере также можно использовать `http://127.0.0.1:8080`.
В явно включённом development mock можно войти
с любым непустым логином; `denied` демонстрирует отказ. Имена регистрозависимы.
Три демонстрационные игры, 36 клубов Лиги чемпионов 2026/27 и их локальные составы создаются автоматически. Первый расчёт
коэффициентов может занять несколько секунд — ставки откроются только после него.

Один внешний HTTP-порт обслуживает frontend, `/api/`, `/socket.io/` и `/play/`.
Порт задаётся `GAMEHUB_PORT` в `.env`; IP в исходниках не задаётся. Домены, DNS,
`hosts`, HTTPS и внешний reverse proxy не нужны. Игры изолированы iframe и
серверной CSP `sandbox allow-scripts` без `allow-same-origin`, а не путём URL.
Подробности защиты и ручной приёмки: [docs/lan-http.md](docs/lan-http.md).

Первый администратор: сначала войдите на сайте под выбранным логином, затем:

```bash
docker compose exec backend python -m backend.manage admin ВАШ_ЛОГИН
```

Это меняет роль существующего профиля, не создаёт способ обхода авторизации.
Обновите страницу. Через админпанель можно выдать право автора другим профилям.

## Production и локальная сеть

1. Скопируйте `.env.example` в `.env`, задайте случайные `POSTGRES_PASSWORD` и
   `SECRET_KEY` (например, `python -c "import secrets; print(secrets.token_hex(32))"`).
2. Оставьте `APP_ENV=production`. **Mock в production запрещён на уровне кода.**
3. Получите контракт существующего API и настройте адаптер по
   [docs/auth.md](docs/auth.md). До настройки новые входы отклоняются с понятной ошибкой.
4. Задайте `GAMEHUB_PORT=8080`, `GAMEHUB_VERSION=3.1.1`, `COOKIE_SECURE=false`.
   Адрес существующего локального API авторизации задаётся в `AUTH_URL`.
5. Заранее соберите и загрузите образы по [инструкции офлайн-переноса](docs/operations.md).
6. Выполните **`docker compose up -d`** и откройте **`http://<IP-компьютера>:<GAMEHUB_PORT>`**.
   PostgreSQL, Redis, backend и сервер игровых файлов наружу не публикуются.
   Runtime Compose не содержит сборки и запрещает скачивание образов.

При обновлении работающего стенда сначала приостановите новые футбольные матчи
в админпанели и дождитесь окончания текущего. Не перезапускайте симулятор посреди
матча с принятыми ставками. Старые `GAME_ORIGIN`, `GAMES_PORT`, `APP_PORT` удалены;
значение прежнего `APP_PORT` перенесите в `GAMEHUB_PORT`.
Это можно сделать командой `python scripts/migrate_env.py`: секреты и настройки
авторизации сохраняются, меняются только устаревшие ключи развёртывания.

## Документация

- [Архитектура и руководство разработчика](docs/development.md)
- [Подключение авторизации](docs/auth.md)
- [Экономика, активность и ставки](docs/economy.md)
- [Футбольная симуляция](docs/simulation.md)
- [HTTP API и realtime](docs/api.md)
- [Обновление, резервные копии, офлайн-перенос](docs/operations.md)
- [Казино: правила, экономика и сопровождение](docs/casino.md)

## Offline development

Dependency bundle рассчитан на `linux/amd64`: Node `22.23.4`, npm `10.9.9`, Python `3.11.18`. На Windows для автономной сборки используйте Docker. Точные версии, хеши lockfile и инструкции проверки находятся в `offline/dependencies.json`.

С одним Docker и без установленного на хосте Node/Python: `scripts/offline.ps1 check` в PowerShell или `bash scripts/offline.sh check` в Linux. Команда запускает чистую сборку backend/frontend с отключённой сетью. После изменения исходников используйте `update`; порядок описан в [OFFLINE_UPDATE.md](OFFLINE_UPDATE.md).

При установленном совместимом Node/Python на Linux:

```bash
cd frontend
npm ci --offline --cache ../offline/npm/cache --no-audit --no-fund
npm run build
cd ..
python -m pip install --no-index --find-links=offline/python/wheels -r requirements.lock
```

Исходники TypeScript, CSS, Python, локальные модели и звуки можно менять без обновления bundle. Для новой внешней npm/Python-библиотеки нужен новый offline cache/wheelhouse. `node_modules`, виртуальное окружение, Docker-образы и готовый deployment archive в Git не входят.

Визуальный ориентир: frontend [ZavodMusic](https://github.com/Slediks/ZavodMusic/tree/master/frontend).
Изучены локальные `index.css`, AppLayout и AlbumCard. Использованы заданные цвета,
системный шрифт, характер границ и карточек; интерфейс и функции написаны для GameHub.

## Проверки

```bash
python -m venv .venv
# Активируйте venv подходящей командой для своей ОС.
pip install -r requirements.lock
pytest -q
ruff check backend shared simulation scripts
ruff format --check backend shared simulation scripts
cd frontend
npm ci
npm run lint
npm run build
npm test
npm run test:e2e
```

Playwright использует Chromium (`npx playwright install chromium` на машине подготовки).
Для установленного Edge задайте `PLAYWRIGHT_CHANNEL=msedge`. Браузерные тесты требуют
запущенного development-стенда. При установке браузера в папку проекта задайте
PLAYWRIGHT_BROWSERS_PATH одинаково для установки и запуска тестов.

Проверка транзакций на отдельной PostgreSQL БД:

```bash
docker compose exec postgres createdb -U gamehub gamehub_test
docker compose -f compose.yaml -f deploy/compose.test.yaml --profile test run --rm tests
```

Тесты отказываются выполнять очистку БД, имя которой не заканчивается на `_test`.
Не используйте production URL для тестирования.
