# /rag-save

Ручное сохранение ключевых выводов и дампа RAG.

Выполняет последовательно:
1. `node cli.js load .kilo/rag-context.json` — загрузить старый дамп (если не загружен)
2. `node cli.js add "..." --meta {...}` — добавить новые выводы (если есть что)
3. `node cli.js save .kilo/rag-context.json` — сохранить на диск
4. `node cli.js search "..." --top 3` — проверить, что контекст находится
