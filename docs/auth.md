# Подключение существующего API авторизации

**Точный контракт не предоставлен. Реальная интеграция пока не настроена.**
Ни URL, ни имена полей в примере ниже не выдаются за контракт существующего сервиса.

Нужно получить от владельца API:

- endpoint и HTTP-метод;
- где передаётся логин (JSON, form, query), точное имя поля и обязательные заголовки;
- примеры успеха, отказа и ошибки;
- стабильный ID пользователя или канонический логин и правила нормализации;
- необходимые TLS/доверенные сертификаты и сервисные credentials, если они есть.

`backend/app/integrations/auth.py` экспортирует `authenticate(login, client_ip) -> Identity`.
Если API использует другую структуру, меняется только этот адаптер и его контрактные
тесты. GameHub не делает собственной проверки IP, регистрации и паролей. При включённом
зашифрованном контексте входной Nginx передаёт backend адрес непосредственного клиента;
пользовательские `X-Forwarded-For` и `X-Edge-Context` Nginx не принимает как источник
этого адреса.

Для простого плоского JSON-ответа доступен настраиваемый шаблон. **Только пример:**

```dotenv
APP_ENV=production
AUTH_ADAPTER=json
AUTH_URL=https://auth.lan/example-check
AUTH_CONTRACT={"method":"POST","transport":"json","login_field":"account","allowed_field":"ok","canonical_login_field":"login","id_field":"subject"}
AUTH_HEADERS={}
```

## Зашифрованный адрес клиента для API

Это **необязательное расширение** существующего JSON-адаптера. Без
`AUTH_CONTEXT_KEY` он по-прежнему отправляет только логин. Заголовок, видимый API,
по умолчанию называется `X-Request-Context`; его имя можно изменить через
`AUTH_CONTEXT_HEADER`. Имя не указывает на IP, а значение не содержит его в открытом
виде. Для включения добавьте к `.env` GameHub:

```dotenv
APP_ENV=production
AUTH_ADAPTER=json
AUTH_URL=http://192.168.1.20:9000/check
AUTH_CONTRACT={"method":"POST","transport":"json","login_field":"account","allowed_field":"ok","canonical_login_field":"login","id_field":"subject"}
AUTH_HEADERS={}
AUTH_CONTEXT_HEADER=X-Request-Context
AUTH_CONTEXT_KEY=64_символа_шестнадцатеричного_ключа
```

Пример адреса и полей здесь не является контрактом вашего API. Сгенерируйте ключ
один раз и задайте **одинаковое значение** на GameHub и API. После загрузки офлайн-
образов ключ можно создать без сети: `docker run --rm --network none python:3.11-slim
python -c "import secrets; print(secrets.token_hex(32))"`. Не добавляйте настоящий ключ
в Git или frontend. Если имя из `AUTH_CONTEXT_HEADER` совпадёт с именем из
`AUTH_HEADERS`, запрос будет отклонён как ошибка конфигурации.

Формат значения заголовка версии 1: `v1.` и base64url от 12-байтового случайного
nonce, шифртекста AES-256-GCM и 16-байтового тега. AAD — байты
`gamehub-auth-context-v1`. Внутри шифртекста JSON с `version`, `login`, `peer`,
`issued_at` (Unix seconds) и случайным `request_id`. Каждый запрос получает новый
nonce и ID. API должен сопоставить расшифрованный `login` с логином в обычном теле
запроса и отклонять старые или повторные ID.

Ниже пример **части API авторизации на Python**. Он показывает приём контекста; ваша
существующая проверка пользователя и IP остаётся в `existing_auth_check`.
`replay_store` — общий Redis для всех процессов API, а не локальный словарь:

```python
import base64
import hmac
import ipaddress
import json
import os
import re
import time

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from flask import Flask, jsonify, request
from redis import Redis

app = Flask(__name__)
replay_store = Redis.from_url(os.environ["AUTH_REPLAY_REDIS_URL"])


def client_address(encrypted_header: str, login: str) -> str:
    version, encoded = encrypted_header.split(".", 1)
    if version != "v1":
        raise ValueError("Unsupported context version")
    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    if len(raw) < 28:  # 12-byte nonce + at least 16-byte GCM tag
        raise ValueError("Invalid context")
    key = bytes.fromhex(os.environ["AUTH_CONTEXT_KEY"])
    if len(key) != 32:
        raise ValueError("Invalid shared key")
    plain = AESGCM(key).decrypt(raw[:12], raw[12:], b"gamehub-auth-context-v1")
    data = json.loads(plain)
    if data.get("version") != 1 or not isinstance(data.get("login"), str):
        raise ValueError("Invalid context fields")
    if not hmac.compare_digest(data["login"], login):
        raise ValueError("Login mismatch")
    issued = data.get("issued_at")
    if type(issued) is not int or abs(time.time() - issued) > 60:
        raise ValueError("Expired context")
    request_id = data.get("request_id")
    if not isinstance(request_id, str) or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid request ID")
    peer = str(ipaddress.ip_address(data["peer"]))
    if not replay_store.set(f"gamehub-auth:{request_id}", "1", nx=True, ex=120):
        raise ValueError("Repeated context")
    return peer


@app.post("/check")
def check():
    try:
        login = request.json["account"]
        peer = client_address(request.headers["X-Request-Context"], login)
    except (InvalidTag, KeyError, TypeError, ValueError):
        return jsonify(ok=False), 403
    # Replace this call with the API's real login and address policy.
    allowed, canonical_login, subject = existing_auth_check(login, peer)
    return jsonify(ok=allowed, login=canonical_login, subject=subject)
```

Запрос к API всё равно приходит по сети **от сервера GameHub**. Проверку сетевого
адреса самого GameHub можно сохранить отдельно; проверка адреса игрока должна
использовать расшифрованный `peer`. Если перед GameHub стоит другой прокси, Nginx
видит его адрес, пока не настроена отдельная цепочка доверенных прокси. При работе
frontend через Vite на `5173` Nginx видит адрес dev-прокси; для проверки реального
адреса игрока используйте обычный вход через `8080`. Шифрование этого заголовка не
защищает остальную часть HTTP-запроса и ответ API; для связи GameHub → API
предпочтителен HTTPS, даже если пользовательский сайт работает по HTTP в LAN.

**Проверка адреса перед включением IP-политики.** На Windows с Docker Desktop
опубликованный порт может показывать контейнеру адрес шлюза Docker вместо адреса
игрока. Запрос с самого компьютера на его LAN-адрес для этой проверки недостаточен:
на текущем тестовом хосте он виден Nginx как `172.20.0.1`. Сделайте вход с другого
устройства в LAN через `http://IP:8080`, временно выведите расшифрованный `peer` в
защищённый журнал самого API и сравните с адресом этого устройства. Не включайте
политику допуска по `peer`, пока совпадение не подтверждено. Если Docker Desktop
подменяет адрес и для удалённых клиентов, понадобится доверенный входной прокси,
сохраняющий исходный адрес; его конфигурацию следует согласовать отдельно. Ни
шифрование, ни заголовки от браузера не восстановят адрес, уже утраченный при
переадресации порта.

Ожидаемый *для этого примера* ответ: `{"ok":true,"login":"Alice","subject":"123"}`.
`allowed_field` должен быть boolean, строка `"true"` не допускает вход.
При отсутствии стабильного ID опустите `id_field`: API тогда обязан возвращать
канонический логин в `canonical_login_field`. GameHub сам регистр не меняет и
пробелы логина не нормализует. Вложенные/нестандартные ответы требуют кода адаптера.

Таймаут подключения 3 с, ответа 5 с. Redirect запрещён. 401/403 — отказ, сетевые
ошибки, timeout и некорректный ответ — 503 с пользовательским сообщением.
Автоматического перехода на mock нет.

`AUTH_ADAPTER=mock` разрешён только вместе с `APP_ENV=development`. Он точно
сохраняет введённый логин, выдаёт `mock:<login>` и отклоняет `denied`. Префикс
mock намеренно отделён от production-идентичностей.

Локальная сессия: случайный 256-битный токен в HttpOnly cookie; БД хранит SHA-256
токена, ID пользователя, CSRF и срок действия. Login меняет токен; logout удаляет
сессию и отключает её sockets. Истечение sockets проверяется каждые 5 секунд.
Cookie host-only, SameSite=Lax, Secure по COOKIE_SECURE. POST/PUT требуют
X-CSRF-Token, включая login. Срок задаёт SESSION_SECONDS. Нет привязки к IP.
