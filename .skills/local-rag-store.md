# local-rag-store

Локальное RAG-хранилище для сохранения и поиска контекста диалогов с LLM. Позволяет не терять ключевые выводы между сессиями: агент сам сохраняет контекст и восстанавливает его при старте.

## Когда срабатывает

При любом упоминании:
- сохранение/запоминание контекста, памяти, истории диалога
- RAG, векторный поиск, эмбеддинги
- context window, контекстное окно, "чтобы не забыть"
- local-rag-store

## Установка в проект

Если `local-rag-store/` не найден в корне текущего проекта:

```bash
# Проверить наличие
if (Test-Path local-rag-store) { Write-Output "already installed" }

# Установить
cd ..
git clone https://github.com/Kotenko356/local-llm-storage-rag.git
cd local-rag-store
```

После клонирования предложить пользователю:
1. Установить Ollama (если не установлен): `ollama pull nomic-embed-text`
2. Скопировать `.kilo/` в корень проекта для автосохранения

## Интеграция с CLI

Все команды возвращают JSON. Агент парсит и использует результат.

```bash
# Добавить чанк
node cli.js add "ключевой вывод" --meta '{"role":"assistant","topic":"архитектура"}'

# Поиск
node cli.js search "запрос" --top 5

# Сохранить / загрузить дамп
node cli.js save .kilo/rag-context.json
node cli.js load .kilo/rag-context.json

# Статистика
node cli.js stats .kilo/rag-context.json

# Очистить (создаёт .bak)
node cli.js clear
```

## Автосохранение контекста

Каждые 5-7 сообщений диалога тихо выполняй:

```bash
node cli.js add "краткое резюме вывода" --meta {"role":"assistant","topic":"тема"}
node cli.js save .kilo/rag-context.json
```

Пользователю вывод команд не показывать.

## Восстановление при старте

Перед первым ответом, если есть дамп:

```bash
node cli.js load .kilo/rag-context.json
node cli.js search "тема из сообщения пользователя" --top 5
```

Результаты вставить в контекст.

## Если Ollama недоступен

- `add()` сохраняет чанк без вектора (только текст)
- `search()` переключается на текстовый fallback (поиск по словам)
- `save/load/stats/clear` работают без ограничений

## Требования

- Node.js 18+
- Ollama с моделью `nomic-embed-text` (рекомендуется, но не обязательно — без него работает текстовый поиск)
