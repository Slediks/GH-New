# HTTP API и realtime

Все пути ниже начинаются с `/api`. JSON в UTF-8, даты — Unix seconds UTC.
Суммы очков — integer в сотых: 10000 = 100 очков. Коэффициент 190 = 1,90.
Все запросы кроме `/auth/session`, `/auth/login` и служебного `/health` требуют
действующую серверную сессию. Изменяющие запросы требуют `X-CSRF-Token` из session.
Cookie HttpOnly автоматически передаётся браузером на origin приложения.

Ошибка имеет единый формат и подходящий HTTP-статус:

```json
{"error":{"code":"insufficient_balance","message":"Недостаточно очков"}}
```

Основные статусы: 400 валидация, 401 вход, 403 права/CSRF, 404 отсутствие объекта,
409 конфликт/закрытое окно, 413 размер файла, 503 недоступность интеграции/БД.
Пагинация: `page` с 1, по 24 записи; каталог и история матчей также возвращают total.

## Авторизация

| Метод и путь | Запрос | Результат |
|---|---|---|
| GET /auth/session | — | `{user: User|null, csrf: string}`; создаёт гостевую CSRF-сессию |
| POST /auth/login | `{login:"Alice"}` | User и новый csrf; новый session cookie |
| POST /auth/logout | `{}` | `{ok:true}`; завершение session и sockets |
| GET /health | — | `{status:"ok"}`, проверка БД и Redis |

User: id, login, role (`user`, `author`, `admin`), balance, active_seconds,
activity_earned. Успешный login создаёт профиль и стартовый журнал только один раз.

## Каталог и автор

| Метод и путь | Параметры / тело |
|---|---|
| GET /categories | список `{items:[{id,name}]}` |
| GET /games | q, category (ID), sort=new/popular/rating, favorites=1, mine=1, page |
| GET /games/:id | объект игры, reviews, my_rating; автору/админу также versions |
| POST /games | multipart/form-data, право автора |
| PUT /games/:id | multipart/form-data, свой объект или admin |
| POST /games/:id/launch | `{}` → `{session_id,url}` |
| PUT /games/:id/favorite | `{favorite:true}` или false |
| PUT /games/:id/rating | `{value:1..5}` |
| PUT /games/:id/review | `{text:"..."}`, 1–2000 символов |
| GET /covers/:filename | нормализованная WebP-обложка |

`launch.url` — относительный `/play/<filename>?ticket=<capability>#session=<id>`
на текущем адресе приложения. Никакого отдельного GAME_ORIGIN не требуется.
Ticket ограничен файлом, сроком и действующей сессией. Игровые ответы содержат
собственную HTTP CSP sandbox; приложение не разрешает API-доступ origin=null.

Поля multipart: title, description, category_id, tags (через запятую),
status (`draft`/`published`), html (файл .html), cover (PNG/JPEG/WebP).
Новый html создаёт версию; отсутствие html при редактировании сохраняет текущую.
У черновика может не быть файла. Для публикации нужна хотя бы одна версия.
После скрытия администратором автор не может самостоятельно вернуть игру.

Game: id, title, description, category_id, category, tags, author, author_id,
cover (URL локальной обложки), status, launches, created_at, rating, rating_count,
favorite. Отзывы — текст, React экранирует содержимое.

## Активность и кошелёк

```http
POST /api/activity/start
X-CSRF-Token: <csrf>
Content-Type: application/json

{"source":"football"}
```

Ответ `{session_id:"..."}`. Для игры сессию создаёт launch, произвольная source не допускается.

```json
{
  "session_id":"серверный id",
  "sequence":2,
  "eligible":true,
  "input_seen":true
}
```

Это тело POST `/activity/heartbeat`. `eligible` означает видимость, фокус и
недавний ввод, `input_seen` — новый ввод с предыдущего heartbeat, а не постоянно
установленный флаг. Ответ: active, credited_seconds, balance, иногда reason.
Секунды и размер начисления клиент не задаёт.

GET `/profile?page=1` → user, transactions, bets.
Transaction: id, kind, amount, balance_after, reason, created_at.
Bet: id, match_id, side (0/1), team_name, created_at, amount, odds, status (pending/won/lost/refunded),
payout, net (null до результата). GET `/leaderboard?metric=balance|activity|bets&page=1`
возвращает items с id, login, balance, active_seconds, net. При равенстве порядок по ID.

## Футбол и ставки

| Метод и путь | Результат / тело |
|---|---|
| GET /football | matches (текущий и следующие), snapshot, previous |
| GET /matches?page=1 | завершённые и отменённые матчи, total |
| GET /matches/:id | Match и сохранённые events |
| POST /matches/:id/bet | `{side:0, amount:2000}` → id, amount, odds |

Match содержит id, state, teams (два зафиксированных объекта), score, penalties,
odds, starts_at, finished_at, winner (0/1/null), statistics, model_version,
probability_a (0…10000), rules. Seed возвращается только в finished.
Для scheduled коэффициенты в интерфейсе считаются неподготовленными: ставки
невозможны до betting_open. Одну ставку на матч нельзя изменить или отменить.
Повтор той же суммы и команды возвращает уже созданную ставку.

## Администратор

Все `/admin/*` требуют role=admin и журналируются при изменениях.

- GET `/admin`: rules, metrics, simulation, teams, последние 50 audit.
- GET `/admin/users?q=&page=1`: профили и баланс.
- GET `/admin/users/:id/transactions?page=1`: операции выбранного профиля.
- GET `/admin/games?page=1`, `/admin/reviews?page=1`: контент, в том числе скрытый.
- POST `/admin/role`: `{user_id,role}`.
- POST `/admin/balance`: `{user_id,amount,reason,request_id}`. amount — подписанное
  целое в сотых. Для повторной доставки сохраняйте request_id.
- POST `/admin/category`: `{name,id?}` — создание/переименование.
- POST `/admin/game`: `{game_id,hidden}`. Возврат скрытой игры переводит её в draft.
- POST `/admin/review`: `{game_id,user_id,hidden}`.
- POST `/admin/settings`: изменяемые ключи правил из docs/economy; paused boolean.
- POST `/admin/team`: `{id,tactic,attributes}`. Все восемь характеристик от 40 до 80.
- POST `/admin/cancel`: `{match_id}` — техническая отмена и возврат.

## Socket.IO

Endpoint `/socket.io/`, стандартный Engine.IO transport. Авторизация через тот же
host-only session cookie, Origin проверяется Socket.IO. Пользовательских room/join
команд нет. Сервер добавляет соединение только в `user:<свой user_id>`.

Событие `snapshot` (10/с):

```json
{
  "match_id":42,"sequence":101,"server_time":1790000000.125,
  "elapsed":10.1,"phase":"live","score":[0,0],"penalties":[0,0],"attempts":[0,0],
  "ball":{"x":50.1,"y":30.2,"vx":2.0,"vy":0.1},
  "players":[{"x":5.0,"y":30.0,"side":0,"number":1,"state":"keeper"}]
}
```

В реальном snapshot всегда 10 игроков. Canvas рисует через requestAnimationFrame,
интерполирует за ~100 мс, не экстраполирует счёт. Старые match_id и sequence
отбрасываются. После connect/reconnect сервер отправляет последний snapshot, а
frontend дополнительно GET /football и историю комментариев текущего матча.

Другие события:

- `phase`: `{match_id,state}` — обновить HTTP-данные матча и правила.
- `comment`: `{match_id,kind,text,elapsed}` — событие того же матча.
- `balance`: `{balance}` — только room владельца после commit операции; UI обновляет профиль.

Для собственных операций HTTP уже возвращает результат; дополнительно session
обновляется каждые 15 секунд. Между проигрыванием и окном ставок новых снимков нет;
интерфейс показывает подготовку. При disconnect выводится состояние переподключения.
