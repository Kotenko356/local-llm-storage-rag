# local-rag-store

Локальное RAG-хранилище без БД. Чанкает текст → эмбеддит через Ollama → хранит векторы в RAM (Map) → ищет косинусным сходством.

| Раздел | Описание |
|--------|----------|
| [Схемы архитектуры](./docs/schemas.md) | Mermaid-диаграммы: data flow, CLI lifecycle, структура JSON |
| [Требования](#требования) | Node.js, Ollama, модель |
| [Установка](#установка) | Клонирование, настройка |
| [API](#api) | Класс LocalRAG — add, search, remove, save, load |
| [CLI](#cli) | Команды для агента: add, search, save, load |
| [Тесты](#тесты) | Запуск smoke-тестов |
| [Ollama](#ollama) | Расход ресурсов, порты, запуск |
| [Интеграция с KiloCode](#интеграция-с-kilocode) | CLI-жизненный цикл сессии |

## Требования

- Node.js 18+
- [Ollama](https://ollama.com/) с моделью `nomic-embed-text`

```bash
ollama pull nomic-embed-text
```

## Установка

```bash
git clone https://github.com/Kotenko356/local-llm-storage-rag.git
cd local-llm-storage-rag
npm install   # нет внешних зависимостей, только type:module
```

## API

```js
import { LocalRAG } from './index.js';

const rag = new LocalRAG({ model: 'nomic-embed-text' });

const id = await rag.add('RAG расшифровывается как Retrieval-Augmented Generation', {
  role: 'assistant',
  conversationId: 'intro-rag',  // опционально
  timestamp: Date.now(),        // опционально (авто)
  messageIndex: 0,              // опционально (автоинкремент)
});

const results = await rag.search('как работает RAG', 3);
// [{ text, similarity, id, meta }, ...]

rag.remove(id);
rag.removeByConversation('intro-rag');
rag.clear();
await rag.save('./context-dump.json');
await rag.load('./context-dump.json');
rag.size(); // количество чанков
```

## CLI

```bash
# Добавить
node cli.js add "RAG — это поиск + генерация. Сначала ищем релевантные чанки, потом докидываем их в промпт LLM"
node cli.js add "спросил про разницу между RAG и fine-tuning" --meta '{"role":"user"}'

# Поиск
node cli.js search "как работает RAG" --top 5

# Персистентность
node cli.js save .kilo/context-dump.json
node cli.js load .kilo/context-dump.json

# Управление
node cli.js clear
node cli.js remove <id>
node cli.js remove-by-conversation <conversationId>
```

Все команды возвращают JSON в stdout.

## Тесты

```bash
node test.js
```

## Ollama

Локальный сервер эмбеддингов. Единственная внешняя зависимость проекта.

### Модель `nomic-embed-text`

| Параметр | Значение |
|----------|----------|
| Размер модели | 137 MB на диске |
| RAM в простое | ~150–300 MB (модель загружена в память) |
| RAM на один запрос | не растёт (единоразовая загрузка) |
| CPU в простое | 0% |
| CPU при эмбеддинге | ~10–15% одного ядра |
| Время эмбеддинга | 5–10 ms на текст (500 chars) |
| Порт | `localhost:11434` |

### Запуск

```bash
ollama serve                        # запустить сервер (если не запущен как сервис)
ollama pull nomic-embed-text        # скачать модель (однократно)
ollama list                         # проверить загруженные модели
```

### Если сервер недоступен

`add()` и `search()` упадут с ошибкой `fetch failed`. Команды без эмбеддингов (`clear`, `save`, `load`, `remove`, `remove-by-conversation`) продолжают работать.

## Интеграция с KiloCode

Агент вызывает CLI через bash в начале и конце сессии:

```bash
# Старт сессии
if [ -f .kilo/rag-context.json ]; then
  node cli.js load .kilo/rag-context.json
  node cli.js search "текущая задача" --top 5
fi

# В ходе сессии — add ключевых выводов

# Конец сессии
node cli.js save .kilo/rag-context.json
```

## Структура проекта

```
local-rag-store/
├── index.js         # Ядро: class LocalRAG
├── embedder.js      # Ollama HTTP-клиент
├── cli.js           # CLI-интерфейс
├── test.js          # Дымовые тесты
├── package.json     # { "type": "module" }
├── docs/
│   └── schemas.md   # Mermaid-диаграммы архитектуры
└── README.md
```
