# Arena Custom Asset Manager

Версия формата 1, 3 ноября 2026. Рабочая установка: существующий Compose `gamehub`,
`http://192.168.1.10:8080`. Раздел: **Администрирование → Арена → Assets · Модели**.

## Как добавить модель

1. Нажмите «Создать Custom Asset» и выберите GLB. Также принимается самодостаточный
   GLTF с buffers/images в data URI. Модель и текстуры проверяются на сервере.
2. В Metadata задайте имя, категорию, описание и tags. ID `custom.<uuid>` создаётся
   сервером и не зависит от имени файла. System Assets доступны только для чтения.
3. В Transform настройте масштаб, ориентацию XYZ и origin: bottom center, center
   или исходный pivot с дополнительным offset. Единицы готовой модели — метры.
   Размеры под preview учитывают эти настройки. Настройки применяются одинаково
   к каждой новой и сохранённой instance этой версии asset.
4. В Collision настройте Player и Bullet отдельно. None отключает слой;
   Auto Box / Asset Bounds охватывает нормализованную модель; Custom Box содержит
   один бокс; Multiple Boxes — до 32 боксов. Bullet может повторять Player.
   В каждом боксе задаются X, нижний Y, Z, width, height, depth. Выберите бокс для
   знакомого gizmo Move/Rotate/Scale; вращение Y кратно 90° обменивает размеры X/Z.
   Поддерживаются копирование и удаление боксов, Ctrl+Z, Ctrl+Y/Ctrl+Shift+Z.
5. В Materials просмотрите импортированные slots. Для каждого отдельно разрешите
   instance overrides: цвет, roughness, metallic, emissive color/intensity.
   Можно создать до 19 вариантов сверх Imported и выбрать вариант в preview.
   Цвет умножается на исходную текстуру; сброс instance возвращает импортированный PBR.
6. Сохраните Draft. Publish повторно проверяет конфигурацию, наличие и checksum
   файла и создаёт новую неизменяемую revision. Черновик не является опубликованной моделью.
7. Откройте Maps: asset появится в общей библиотеке с меткой Custom. Поиск учитывает
   имя, ID, категорию и tags. Add/Move/Rotate/Scale/Duplicate/Group/Undo/Redo,
   сохранение, Play Test, Test Room и обычная публикация карты используют тот же pipeline.

Preview: ЛКМ orbit, ПКМ pan, колесо zoom, кнопка фокуса, сетка 1 м, переключатели
модели и двух слоёв коллизии. Thumbnail создаётся из preview и скачивается как PNG;
вводить отдельную картинку не нужно. В этой версии thumbnail не хранится в библиотеке.
Редактор рассчитан на desktop, обе темы используют существующие цвета GameHub.

## Версии и сохранность данных

`arena_assets` хранит черновик и счётчик optimistic concurrency. Save/Publish,
Replace, Duplicate, Disable/Archive используют существующие права admin и CSRF.
Устаревший счётчик возвращает 409: чужие изменения не перезаписываются. Локальный
черновик можно экспортировать в JSON. Изменения фиксируются в существующем audit log.

`arena_asset_revisions` — append-only. PostgreSQL запрещает UPDATE/DELETE триггером.
Публикация следующей revision не меняет прежние. Replace меняет только Draft,
сбрасывая настройки геометрии/материалов для новой модели. Duplicate создаёт новый
ID с копией сохранённой конфигурации и ссылкой на те же неизменяемые bytes.

MapObject сохраняет `assetId` и `assetVersion`. Компилятор карты разрешает точную
версию и помещает registry metadata, материалы, model resource и коллайдеры в
immutable snapshot карты. Несколько revisions одного ID могут находиться в одной
карте; registry использует ключи `id@version`, сохраняя совместимость со старыми
ключами `id`. Runtime и reconnect работают по snapshot матча.

Если доступна новая версия, inspector выбранного объекта предлагает явное обновление.
Оно сохраняет transform объекта, сбрасывает instance properties/material overrides
к defaults новой версии и входит в Undo/Redo. Массового автоматического обновления нет.

Disable/Archive убирает asset из новых размещений; сохранённые instances продолжают
работать, включая старые опубликованные карты. Физического удаления revisions и файлов
нет. Неопубликованные assets на карту пока не размещаются: проверка Draft выполняется
в собственном preview; перед использованием в карте требуется Publish asset.

## Импорт и ограничения первой версии

| Ограничение | Значение |
|---|---|
| Файл модели | 50 MiB; запрос загрузки 51 MiB с multipart |
| Формат | GLB 2 / самодостаточный GLTF 2 core PBR |
| Уникальные vertices | до 500 000 в файле |
| Vertices / triangles с учётом повторений узлов | 500 000 / 300 000 |
| Meshes / nodes / materials | 256 / 1024 / 64 |
| Primitives на mesh | 64 |
| Глубина node hierarchy | 32 |
| Текстуры | PNG/JPEG, до 32, не более 4096×4096 каждая |
| Оценка памяти текстур с mipmaps | до 256 MiB на asset |
| Colliders | до 32 на каждый слой |
| Collider размер | 0,01–250 м; координаты ±250 м |
| Normalized bounds | внутри ±250 м |

Рекомендуются текстуры 1024–2048. Более 50 000 triangles или 64 MiB texture memory
дают предупреждение; BLEND также отмечается как более дорогой. Это оценки, а не обещание FPS.
Повторение тяжёлых моделей требует отдельной проверки карты на целевом компьютере.

Поддерживаются импортированные base color/texture, metallic/roughness, normal maps,
emissive, alpha OPAQUE/MASK/BLEND и double-sided, как в core GLTFLoader.
Material variants меняют PBR-параметры; переключения texture set в UI пока нет.
Текстуры остаются внутри content-addressed GLB/GLTF, не создавая внешних зависимостей.

Внешние URL, относительные `.bin`/image ссылки, произвольные shaders и glTF extensions
(включая Draco/KTX), skin, sparse accessors, morph targets и нетреугольные primitives
отклоняются с объяснением. Экспортируйте static core PBR GLB без этих расширений.
Animations и камеры удаляются при нормализации; анимации не запускаются.
Hierarchy модели сохраняется внутри одной map instance. Gameplay entities, динамические
тела и visual-mesh collision через Custom Asset Manager не создаются.

Сервер проверяет заголовок/длину GLB, buffers/views/accessors/indices, ссылки материалов,
конечность transform, циклы узлов и изображения. Bounds пересчитываются по POSITION,
а не принимаются на веру из JSON. Имена — обычный текст, React не вставляет их как HTML.
Файлы адресуются SHA-256, original filename не используется как путь.

## Общий renderer и ресурсы

`custom_assets/importer.py` — проверка и нормализация данных;
`configuration.py` — transforms, slots, collider metadata;
`service.py` / `routes.py` — storage, версии, права и audit;
`shared/arena_asset_models.py` — модели БД.

Frontend `arena/assets/` содержит менеджер, форму и отдельный 3D-preview;
`editor/customModels.ts` — общий loader/cache для editor/runtime. Системные
procedural assets продолжают использовать прежний путь `dataScene.ts`.

Одна модель загружается один раз на scene context; instances разделяют geometry,
textures и одинаковые materials. Разные overrides получают независимые материалы;
при изменении параметров старые варианты освобождаются по счётчикам ссылок. Внутренние
mesh узлы не попадают в map hierarchy. При закрытии сцены освобождаются geometry,
textures, ImageBitmap и materials, незавершённые fetch прерываются. Поздний ответ не
добавляет модель в уже удалённую instance.

Custom mesh не включается в прежний primitive batching, который не учитывает texture
maps. Общие buffers и materials переиспользуются, но GPU instancing/LOD для импортированных
моделей пока нет. Missing resource показывает wireframe placeholder и понятную ошибку,
остальная Arena продолжает работать. Model IDs проверяются и на клиенте; загрузка
идёт только с собственного `/api/arena/asset-resources/<sha256>.<glb|gltf>`.

Для resource URL действуют авторизация и приватный immutable HTTP cache. Обычный
пользователь получает только файл, использованный хотя бы в одной опубликованной
asset revision. Draft-only файлы доступны admin. Отключение asset не отзывает файл
у опубликованных карт. CSP разрешает локальные blob для встроенных текстур GLTFLoader,
но не внешние HTTP-зависимости.
Draft-only ресурсы возвращаются с `no-store`, чтобы не сохраняться в браузерном кеше
после выхода администратора из аккаунта.

## Миграция, Docker и офлайн-запуск

Миграция `c4912a780012` добавляет две таблицы и триггер, не преобразуя прежние карты,
матчи, авторизацию, кошельки или пользовательские данные. Перед применением создана
и проверена резервная копия `backups/gamehub-before-custom-assets-20261102.dump`
(55 477 975 bytes, 276 TOC entries). Каталог backups исключён из Git/Docker.

Файлы находятся в существующем persistent volume `game_files`, путь
`/data/arena-assets`. При переносе/восстановлении сохраняйте **и PostgreSQL, и этот volume**.
Нет нового сервиса, Compose-проекта, порта или внешнего хранилища. Нужен прежний комплект
Docker images и локальные данные; runtime не требует интернета. Автоматической очистки
draft ресурсов нет: они сохраняются, чтобы не удалить shared/published bytes ошибочно.
Периодически контролируйте размер volume; ручное удаление по одному лишь возрасту запрещено.

## Проверки

- Все backend Arena tests: **241 passed**, включая 18 новых проверок импорта,
  ограничений, ссылок, материалов, ревизий, прав и независимой collision.
- Все frontend unit tests: **90 passed**, включая 3 проверки custom pool:
  100 instances / одна загрузка / shared geometry, независимые overrides, cleanup,
  поздняя загрузка удалённого объекта и нормализованные bounds.
- TypeScript, ESLint для затронутых frontend модулей, Ruff для нового backend — успешно.
- Desktop Edge на 8080: загрузка текстурированного GLB, preview, scale, collision,
  сохранение и публикация; общий Asset Browser, overrides, Play Test, 30 instances
  и два браузера обычного матча, публикация новой revision, reconnect со старой
  collision, явное обновление draft dependency и доступность disabled resource.
- Пять desktop браузерных сценариев прошли: новый Asset Manager и четыре регрессионных
  сценария Map Editor/Material Overrides. В новом проверены также variants preview,
  compound collider, undo/redo. Один первый прогон не дождался холодной загрузки второго
  клиента за 5 секунд; повтор с ожиданием до 30 секунд прошёл.
- PostgreSQL: пробная UPDATE опубликованной asset revision отклонена триггером;
  проверочная транзакция отменена.
- Результаты браузера: `arena-custom-assets-browser.json`;
  screenshot: `screenshots/arena-custom-assets.png`.

На проверочной карте с 30 экземплярами медиана кадра — 13,3 мс, p95 — 13,5 мс (desktop Edge на текущем компьютере).
Синтетическая модель в браузерной проверке мала. Результат не доказывает производительность
максимальных 300 000 triangles × сотни instances. Server hit detection проверен на
скомпилированных bullet boxes; отдельный сценарий попадания по игроку за каждой возможной
пользовательской моделью не подменяет проверку конкретной авторской карты.

Встроенный TODO API Codex отсутствовал в доступных инструментах этой сессии;
tracking-файлы не создавались, этапы сообщались в чате.
