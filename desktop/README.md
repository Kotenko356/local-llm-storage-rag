# desktop — GUI монитор local-rag-store

Десктоп-приложение на Tauri (Rust + WebView). Читает JSON-дамп, который создаёт CLI, и показывает его содержимое.

## Возможности

- **Dashboard** — статистика: количество чанков, диалогов, RAM
- **Поиск** — по тексту, роли, conversationId
- **Связи** — граф похожих чанков на основе cosine similarity
- **Диалоги** — список всех conversationId с числом сообщений
- **Очистка** — с автоматическим созданием `.bak`

## Сборка

```powershell
cd desktop
cargo tauri build
```

Бинарник: `src-tauri/target/release/local-rag-store.exe`

## Использование

1. Запустить `local-rag-store.exe`
2. Указать путь к дампу (например `.kilo/rag-context.json`)
3. Нажать «Загрузить»

## Зависимости

- Rust 1.70+
- WebView2 (встроен в Windows 10/11)
