# local-rag-store

Локальное RAG-хранилище без БД. Чанкает текст → эмбеддит через Ollama → хранит векторы в RAM (Map) → ищет косинусным сходством.

## Требования

- Node.js 18+
- [Ollama](https://ollama.com/) с моделью `nomic-embed-text`

```bash
ollama pull nomic-embed-text
```

## Установка

```bash
git clone <url> local-rag-store
cd local-rag-store
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
├── index.js       # Ядро: class LocalRAG
├── embedder.js    # Ollama HTTP-клиент
├── cli.js         # CLI-интерфейс
├── test.js        # Дымовые тесты
├── package.json   # { "type": "module" }
└── README.md
```
