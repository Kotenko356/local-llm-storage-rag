import { LocalRAG } from './index.js';

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

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    print({ usage: 'add|search|load|save|clear|remove|remove-by-conversation ...' });
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

    default: {
      fatal(`Unknown command: ${command}`);
    }
  }
}

main().catch(err => fatal(err.message));
