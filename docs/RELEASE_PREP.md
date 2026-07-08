# Release prep — Open Media Downloader

## Что изменено в этом дизайн-проходе

- Расширение переименовано в `Open Media Downloader`.
- Версия в `manifest.json` поднята до `0.2.0`.
- Добавлены PNG-иконки `16`, `32`, `48`, `128` и SVG-исходник.
- Обновлён popup: более чистый header, карточка состояния, акцентная кнопка панели, диагностика спрятана в раскрываемый блок.
- Обновлена full panel: новая hero-зона, карточки статистики, фильтры и карточки потоков.
- Обновлены HLS/DASH/playlist downloader страницы визуально, без изменения их JS-логики.
- Улучшен CSS инжектируемых кнопок, включая отдельный компактный стиль для кнопок внутри строк SoundCloud-плейлистов.

## Что специально не трогалось

- background download logic;
- SoundCloud resolve/capture logic;
- HLS/DASH parsing and downloading modules;
- playlist batch-download logic;
- storage/message-router/state modules;
- permissions/host_permissions, чтобы не сломать текущую механику.

## Важное про repomix-архив

В присланном repomix-файле нет бинарного файла:

- `vendor/ffmpeg/core/ffmpeg-core.wasm`

Поэтому этот архив лучше применять как patch поверх локального рабочего репозитория, где этот файл уже есть. Если собрать extension ZIP только из repomix-реконструкции, функции, которые требуют ffmpeg.wasm, могут не работать.

## Рекомендуемый порядок проверки

1. Скопировать файлы patch-архива поверх текущего репозитория.
2. Проверить, что `vendor/ffmpeg/core/ffmpeg-core.wasm` остался на месте.
3. Открыть `chrome://extensions`.
4. Включить Developer mode.
5. Нажать Load unpacked и выбрать папку расширения.
6. Проверить:
   - popup открывается;
   - кнопка панели открывает panel;
   - найденные потоки отображаются;
   - прямые скачивания работают;
   - HLS/DASH downloader открывается;
   - playlist downloader запускается;
   - кнопки на страницах не ломают layout.

## Следующий безопасный шаг

После визуального прохода лучше отдельно заняться магазинной подготовкой:

- privacy policy URL;
- screenshots 1280×800;
- permission justifications;
- review notes для `webRequest`, `<all_urls>` и локального wasm;
- private/unlisted release перед public.
