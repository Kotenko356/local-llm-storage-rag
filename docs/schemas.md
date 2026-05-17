# Схемы local-rag-store

## О системе

`local-rag-store` — локальное RAG-хранилище для сохранения и поиска контекста диалогов с LLM.

### Как работает

1. **CLI** (`cli.js`) — основной инструмент. Агент (KiloCode) или пользователь вызывает команды через bash: добавляет ключевые выводы, ищет релевантные чанки, сохраняет дамп.
2. **LocalRAG** (`index.js`) — ядро. Хранит векторы в RAM (Map), превращает текст в эмбеддинги через Ollama, ищет косинусным сходством.
3. **JSON-дамп** — файл на диске. CLI сохраняет/загружает всё состояние сессии.
4. **Десктоп-монитор** (`desktop/`) — опциональный Tauri GUI. Читает тот же JSON-дамп, показывает статистику и связи. **Не обязателен** — CLI полностью покрывает просмотр содержимого.

### CLI достаточен для просмотра

```bash
# Поиск по тексту
node cli.js search "что обсуждали про архитектуру" --top 5

# Поиск без эмбеддинга (все чанки)
node cli.js search "" --top 100

# Посмотреть размер хранилища
node cli.js list  # (если реализовано)
```

Десктоп-приложение — исключительно для тех, кому удобнее визуальный интерфейс. Пользоваться или нет — личное желание.

---

## Архитектура (CLI + опциональный Desktop)

```mermaid
flowchart LR
    subgraph CLI ["CLI (основной канал)"]
        A1[KiloCode / Пользователь] -->|bash: add / search / save / load| B[cli.js]
    end

    subgraph CORE ["RAG Core (index.js)"]
        B -->|"new LocalRAG()"| C[LocalRAG]
        C -->|embed(text)| D[embedder.js]
        D -->|POST /api/embed| E[Ollama\nnomic-embed-text]
        E -->|вектор 768D| C
        C -->|"Map<id, {v, text, meta}>"| F[RAM]
        C -->|save / load| G[JSON дамп\nна диске]
    end

    subgraph DESKTOP ["Desktop (опционально)"]
        H[Tauri GUI\nRust + WebView] -->|read_stats / search / list| G
        H -->|dashboard + граф| I[Пользователь\nс GUI]
    end

    F -->|search: cosine similarity| C
    C -->|JSON-результаты| B
    B -->|stdout JSON| A1
```

## Data Flow: add()

```mermaid
sequenceDiagram
    participant Agent as KiloCode / Пользователь
    participant RAG as LocalRAG
    participant Embed as embedder.js
    participant Ollama as Ollama (nomic-embed-text)

    Agent->>RAG: add(text, { role, conversationId, ... })
    RAG->>RAG: определить role (default: assistant)
    RAG->>RAG: сгенерировать conversationId / messageIndex
    RAG->>Embed: embed(text)
    Embed->>Ollama: POST /api/embed { model, input }
    Ollama-->>Embed: embeddings[0] (768 floats)
    Embed-->>RAG: вектор
    RAG->>RAG: сохранить { id, v, text, meta } в Map
    RAG-->>Agent: id
```

## Data Flow: search()

```mermaid
sequenceDiagram
    participant Agent as KiloCode / Пользователь
    participant RAG as LocalRAG
    participant Embed as embedder.js
    participant Ollama as Ollama (nomic-embed-text)

    Agent->>RAG: search(query, topK)
    RAG->>Embed: embed(query)
    Embed->>Ollama: POST /api/embed { model, input }
    Ollama-->>Embed: embeddings[0]
    Embed-->>RAG: queryVec
    loop для каждого чанка в Map
        RAG->>RAG: cosineSimilarity(queryVec, chunk.v)
    end
    RAG->>RAG: отсортировать по similarity, взять topK
    RAG-->>Agent: [{ text, similarity, id, meta }, ...]
```

## Data Flow: save / load

```mermaid
sequenceDiagram
    participant Agent as KiloCode / Пользователь
    participant RAG as LocalRAG
    participant FS as Файловая система

    Agent->>RAG: save(path)
    RAG->>RAG: сериализовать Map → JSON { version, savedAt, chunks }
    RAG->>FS: writeFile(path, JSON)
    FS-->>RAG: ok
    RAG-->>Agent: { ok: true }

    Agent->>RAG: load(path)
    RAG->>FS: readFile(path)
    FS-->>RAG: JSON
    RAG->>RAG: восстановить Map, conversationCounters
    RAG-->>Agent: { ok: true, size }
```

## CLI Lifecycle (интеграция с KiloCode)

```mermaid
flowchart TD
    Start[Старт сессии KiloCode] --> Load{есть дамп?}
    Load -->|да| Load_file[load .kilo/rag-context.json]
    Load_file --> Search[search по теме сессии]
    Search --> Work[Работа с пользователем]
    Load -->|нет| Work

    Work -->|ключевые выводы| Add[add текст --meta]

    Work --> End[Конец сессии]
    End --> Save[save .kilo/rag-context.json]
```

## Desktop Monitor (опционально)

```mermaid
flowchart LR
    subgraph GUI ["Tauri Desktop App"]
        direction TB
        D1[Dashboard\nчанки / диалоги / RAM]
        D2[Explorer\nпоиск по тексту, роли]
        D3[Graph\nсвязи между чанками]
        D4[Conversations\nсписок диалогов]
    end

    JSON[JSON дамп\nна диске] -->|Rust: read / search| GUI
    GUI -->|кнопка| CLEAR[Очистить с бэкапом]
    GUI -->|кнопка| REFRESH[Перечитать дамп]

    style GUI fill:#2a3d35,stroke:#7a9a92
    style JSON fill:#474a50,stroke:#7a9a92
```

## Структура JSON-дампа

```mermaid
mindmap
  root((context-dump.json))
    version: 1
    savedAt: ISO-8601
    model: nomic-embed-text
    chunks
      chunk_id_1
        v: [0.12, -0.34, ...]
        text: строка чанка
        meta
          role: assistant | user | system
          conversationId: str
          timestamp: number
          messageIndex: number
          topic?: str
          ...
```

## Полная диаграмма компонентов

```mermaid
flowchart TB
    subgraph User["Пользователь"]
        UA[Агент KiloCode]
        UH[Человек]
    end

    subgraph CLI_Layer["CLI (Node.js)"]
        CLI[cli.js\nadd / search / save / load / clear / remove]
        INDEX[index.js\nclass LocalRAG]
        EMBED[embedder.js\nOllama HTTP client]
    end

    subgraph Desktop_Layer["Desktop (Tauri/Rust) — опционально"]
        TAURI[lib.rs\nread_stats / search_chunks\nget_related / list_conversations]
        HTML[index.html + style.css + app.js\nDashboard / Explorer / Graph]
    end

    subgraph Storage["Хранилище"]
        JSON_FILE[JSON-дамп на диске]
        RAM[Map в оперативной памяти]
    end

    subgraph External["Внешние зависимости"]
        OLLAMA[Ollama\nnomic-embed-text\nlocalhost:11434]
    end

    UA -->|bash| CLI
    UH -->|запуск exe| TAURI

    CLI --> INDEX
    INDEX --> EMBED
    EMBED --> OLLAMA
    INDEX --> RAM
    INDEX --> JSON_FILE

    TAURI --> JSON_FILE
    HTML --> TAURI

    style Desktop_Layer fill:#2a3d35,stroke:#7a9a92,stroke-dasharray: 5 5
    style User fill:#3b3f45,stroke:#9aa8b5
    style External fill:#3d2430,stroke:#b89ac8
```

> **Примечание:** Desktop-монитор — опциональная надстройка. Для просмотра содержимого достаточно CLI-команд. Пользоваться GUI или нет — исключительно личное предпочтение.
