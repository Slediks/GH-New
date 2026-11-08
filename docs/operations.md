# Эксплуатация и офлайн-развёртывание

Настройки фиксированной цены и диапазона входа столов требуют миграции `c4912a780005`. Перед обновлением существующей базы следуйте [порядку миграции стоимости столов](table-pricing.md#миграция-и-развёртывание); активные партии сохраняют прежнюю цену.

Целевая среда — Docker Compose v2 с Linux-контейнерами (в том числе Docker Desktop
на Windows). Исходный код и образы можно подготовить
на подключённой машине; работающий сервер не обращается к CDN, внешним шрифтам,
аналитике или моделям. Внешний API авторизации должен быть доступен в локальной сети.

## Перенос на изолированный сервер

На машине подготовки с той же архитектурой CPU:

```bash
docker compose -f compose.yaml -f compose.build.yaml build backend nginx
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker pull nginx:1.27-alpine
docker save -o gamehub-images.tar gamehub-backend:3.0.1 gamehub-frontend:3.0.1 \
  postgres:16-alpine redis:7-alpine nginx:1.27-alpine
sha256sum gamehub-images.tar > gamehub-images.tar.sha256
```

Версия тегов должна совпадать с `GAMEHUB_VERSION` (по умолчанию 3.0.1).
Для упаковки уже проверенных локальных образов скрипт `prepare-offline.ps1`
принимает `-SkipBuild -SkipPull`. В этом режиме он проверяет наличие образов,
не пересобирает их и не обновляет зависимости перед экспортом.
На Windows ту же подготовку автоматизирует `powershell -File scripts/prepare-offline.ps1`.
Скрипт не запускает тесты и не включает реальные секреты `.env` в поставку.

Передайте архив, контрольную сумму, compose.yaml, deploy/games.conf, .env.example
и документацию. Секреты .env создайте на сервере отдельно. Полный исходный код
также рекомендуется хранить рядом для сопровождения, но runtime не требует npm/pip.

```bash
sha256sum -c gamehub-images.tar.sha256
docker load -i gamehub-images.tar
# Настройте .env: секреты, GAMEHUB_PORT, реальный локальный AUTH_URL и его контракт.
docker compose up -d
docker compose ps
```

Откройте `http://<IP-компьютера>:<GAMEHUB_PORT>`; по умолчанию порт 8080.
Только nginx публикует порт на 0.0.0.0. PostgreSQL, Redis, backend и games доступны
внутри Docker. Игровые URL относительные `/play/...`; API и WebSocket используют
тот же адрес. Для смены IP исходники и `.env` менять не нужно; для смены порта
измените `GAMEHUB_PORT` и выполните `docker compose up -d`.
Сессия: HttpOnly, SameSite=Lax, без Domain, `COOKIE_SECURE=false` для HTTP.
DNS, hosts, сертификаты и HTTPS-редиректы не используются.

В runtime Compose нет `build`, у каждого образа `pull_policy: never`.
Если образ не загружен, запуск завершится ошибкой, а не станет скачивать его.
Npm/pip нужны только машине подготовки. На Windows контрольную сумму архива
можно получить через `Get-FileHash gamehub-images.tar -Algorithm SHA256` и сверить
с переданной суммой; `docker load` и `docker compose up -d` одинаковы для обеих ОС.

## Обновление

1. В админпанели приостановите новые матчи. Дождитесь текущего результата и расчёта.
2. Сделайте согласованную резервную копию.
3. Загрузите новые версионированные образы, замените теги в compose.
4. `docker compose run --rm migrate` применит миграции и идемпотентные начальные данные.
5. `docker compose up -d --no-build --pull never` и проверка `/api/health`.
6. Проверьте login, игру и футбол, возобновите новые матчи.

При изменении физики меняйте SIMULATION_VERSION, чтобы не переиспользовать старые
коэффициенты. Для production зафиксируйте digest образов после сборки. Не выполняйте
`docker compose down -v`, если нужны сохранённые данные.

## Резервное копирование

Скрипт рассчитан на Linux/bash. Он кратковременно останавливает процессы записи,
создаёт PostgreSQL custom-format dump и tar игровых файлов, затем запускает сервисы.
Для отсутствия отменённых матчей сначала дождитесь конца текущего матча с paused=true.

```bash
bash scripts/backup.sh backups/2026-09-17
```

Храните вместе `database.dump`, `games.tar.gz`, `SHA256SUMS`, версию образов и защищённую
копию конфигурации. В БД находятся сессии и профили: доступ к архиву должен быть ограничен.
Периодически проверяйте восстановление на отдельном сервере/проекте Compose.

## Восстановление

На отдельном чистом стенде с соответствующей версией образов и .env:

```bash
docker compose up -d postgres redis
docker compose stop nginx backend simulation
docker compose exec -T postgres pg_restore -U gamehub -d gamehub --clean --if-exists < backups/2026-09-17/database.dump
docker compose run --rm --no-deps -T backend tar -C /data -xzf - < backups/2026-09-17/games.tar.gz
docker compose run --rm migrate
docker compose up -d --no-build --pull never
```

Команда pg_restore заменяет данные целевой БД содержимым резервной копии. Запускайте
её только на выбранном стенде восстановления. Сохраняйте исходную копию неизменной.
Новые миграции применяются после восстановления. При восстановлении live/penalties
симулятор отменяет матч и возвращает ставки, если результат не был надёжно сохранён.
Повторный запуск recover не повторяет выплаты.

## Наблюдение

```bash
docker compose ps
docker compose logs --tail 100 backend simulation
docker compose exec backend alembic current
```

`/api/health` проверяет БД и Redis. Отдельный healthcheck симулятора проверяет его
обновляемый ключ; подробный статус и последняя ошибка доступны в админпанели.
Симулятор при потере БД/Redis прекращает работу, что приводит к восстановлению
при автоматическом перезапуске. При отсутствии auth API уже созданные сессии
продолжают жить до своего срока, новые входы закрыты.

Начальные образы содержат тестовые инструменты для воспроизводимости. Для более
компактного production-образа можно отделить dev lock после завершения приёмки.
Запущенный local dev mock и тестовые профили предназначены только для проверки;
они не являются production-учётными записями.
