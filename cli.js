import { LocalRAG } from './index.js';
import { statSync, existsSync } from 'node:fs';

const rag = new LocalRAG();

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

function fatal(msg) {
  print({ error: msg });
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') {
      args.top = parseInt(argv[++i], 10);
    } else if (a === '--meta') {
      try {
        args.meta = JSON.parse(argv[++i]);
      } catch {
        fatal('Invalid JSON in --meta');
      }
    } else if (a.startsWith('--')) {
      args[a.slice(2)] = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

function countConversations(rag) {
  const seen = new Set();
  for (const chunk of rag.chunks.values()) {
    if (chunk.meta.conversationId) seen.add(chunk.meta.conversationId);
  }
  return seen.size;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    print({ usage: 'add|search|load|save|clear|remove|remove-by-conversation|stats ...' });
    process.exit(1);
  }

  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case 'add': {
      if (!args._[0]) fatal('Usage: cli.js add <text> [--meta <json>]');
      const text = args._[0];
      const meta = args.meta || {};
      meta.role = meta.role || 'assistant';
      const id = await rag.add(text, meta);
      print({ ok: true, id });
      break;
    }

    case 'search': {
      if (!args._[0]) fatal('Usage: cli.js search <query> [--top <n>]');
      const query = args._[0];
      const topK = args.top || 5;
      const results = await rag.search(query, topK);
      print({ results });
      break;
    }

    case 'load': {
      if (!args._[0]) fatal('Usage: cli.js load <path>');
      await rag.load(args._[0]);
      print({ ok: true, size: rag.size() });
      break;
    }

    case 'save': {
      if (!args._[0]) fatal('Usage: cli.js save <path>');
      await rag.save(args._[0]);
      print({ ok: true, size: rag.size() });
      break;
    }

    case 'clear': {
      rag.clear();
      print({ ok: true });
      break;
    }

    case 'remove': {
      if (!args._[0]) fatal('Usage: cli.js remove <id>');
      const removed = rag.remove(args._[0]);
      print({ ok: removed });
      break;
    }

    case 'remove-by-conversation': {
      if (!args._[0]) fatal('Usage: cli.js remove-by-conversation <conversationId>');
      const count = rag.removeByConversation(args._[0]);
      print({ ok: true, removed: count });
      break;
    }

    case 'stats': {
      const chunkCount = rag.size();
      const estimatedRamKb = chunkCount * 7;
      let ollamaStatus = 'unknown';
      let modelInfo = '';

      try {
        const res = await fetch('http://localhost:11434/api/tags');
        if (res.ok) {
          const data = await res.json();
          ollamaStatus = data.models?.some(m => m.name.includes(rag.model))
            ? `connected (${rag.model})`
            : `running (model "${rag.model}" not pulled)`;
        } else {
          ollamaStatus = `error (HTTP ${res.status})`;
        }
      } catch {
        ollamaStatus = 'unreachable';
      }

      const result = {
        chunks: chunkCount,
        conversations: countConversations(rag),
        estimatedRamKb,
        ollama: ollamaStatus,
      };

      if (args._[0]) {
        const path = args._[0];
        if (existsSync(path)) {
          const s = statSync(path);
          result.dump = {
            path,
            size: s.size,
            modified: s.mtime.toISOString(),
          };
        } else {
          result.dump = { path, exists: false };
        }
      }

      print(result);
      break;
    }

    default: {
      fatal(`Unknown command: ${command}`);
    }
  }
}

main().catch(err => fatal(err.message));
