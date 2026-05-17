import { LocalRAG } from './index.js';
import { unlinkSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const DUMP = './test-dump.json';
let passed = 0;
let failed = 0;

function mockEmbed(text) {
  const seed = [...text].reduce((s, c) => s + c.charCodeAt(0), 0);
  let state = seed | 0;
  return Array.from({ length: 4 }, () => {
    state = (state * 1103515245 + 12345) | 0;
    return ((state >>> 0) / 4294967296) * 2 - 1;
  });
}

function createRAG() {
  return new LocalRAG({ embed: mockEmbed });
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function cleanup() {
  try { unlinkSync(DUMP); } catch {}
}

async function run() {
  console.log('\nlocal-rag-store — smoke tests\n');

  await test('constructor creates empty store', () => {
    const rag = createRAG();
    assert.equal(rag.size(), 0);
  });

  await test('add and search returns results sorted by similarity', async () => {
    const rag = createRAG();
    await rag.add('RAG расшифровывается как Retrieval-Augmented Generation', {
      role: 'assistant',
      conversationId: 'test-conv',
    });
    await rag.add('PRO=$4.99/мес, ULTRA=$9.99/мес', {
      role: 'assistant',
      conversationId: 'test-conv',
    });
    await rag.add('как работает RAG?', { role: 'user', conversationId: 'test-conv' });

    assert.equal(rag.size(), 3);

    const results = await rag.search('расскажи про RAG', 2);
    assert.equal(results.length, 2);
    assert.ok(results[0].similarity > results[1].similarity);
    assert.ok(results[0].text);
    assert.ok(results[0].id);
    assert.ok(results[0].meta);
    assert.ok(results[0].meta.role);
  });

  await test('search on empty store returns []', async () => {
    const rag = createRAG();
    const results = await rag.search('anything', 5);
    assert.deepEqual(results, []);
  });

  await test('save and load roundtrip preserves all data', async () => {
    cleanup();
    const rag1 = createRAG();
    await rag1.add('сохранённый текст', { role: 'user', conversationId: 'persist', topic: 'test' });
    await rag1.save(DUMP);

    const rag2 = createRAG();
    await rag2.load(DUMP);
    assert.equal(rag2.size(), 1);

    const [chunk] = rag2.chunks.values();
    assert.equal(chunk.text, 'сохранённый текст');
    assert.equal(chunk.meta.role, 'user');
    assert.equal(chunk.meta.conversationId, 'persist');
    assert.equal(chunk.meta.topic, 'test');

    cleanup();
  });

  await test('remove single entry by id', async () => {
    const rag = createRAG();
    const id1 = await rag.add('текст для удаления', { role: 'user', conversationId: 'remove-test' });
    const id2 = await rag.add('останется', { role: 'user', conversationId: 'remove-test' });

    assert.equal(rag.size(), 2);

    const removed = rag.remove(id1);
    assert.ok(removed);
    assert.equal(rag.size(), 1);

    const [remaining] = rag.chunks.values();
    assert.equal(remaining.text, 'останется');
  });

  await test('remove of non-existent id returns false', () => {
    const rag = createRAG();
    const removed = rag.remove('nonexistent');
    assert.equal(removed, false);
  });

  await test('removeByConversation removes all entries for a conversation', async () => {
    const rag = createRAG();
    await rag.add('сообщение 1', { role: 'user', conversationId: 'conv-a' });
    await rag.add('сообщение 2', { role: 'assistant', conversationId: 'conv-a' });
    await rag.add('другая тема', { role: 'user', conversationId: 'conv-b' });

    assert.equal(rag.size(), 3);

    const count = rag.removeByConversation('conv-a');
    assert.equal(count, 2);
    assert.equal(rag.size(), 1);

    const [remaining] = rag.chunks.values();
    assert.equal(remaining.meta.conversationId, 'conv-b');
  });

  await test('clear removes all entries', async () => {
    const rag = createRAG();
    await rag.add('что-то', { role: 'user' });
    await rag.add('ещё что-то', { role: 'assistant' });
    assert.equal(rag.size(), 2);

    rag.clear();
    assert.equal(rag.size(), 0);
  });

  await test('meta defaults are applied (role=assistant, auto IDs)', async () => {
    const rag = createRAG();
    const id = await rag.add('только текст');

    const chunk = rag.chunks.get(id);
    assert.equal(chunk.meta.role, 'assistant');
    assert.ok(chunk.meta.conversationId);
    assert.ok(typeof chunk.meta.timestamp === 'number');
    assert.ok(typeof chunk.meta.messageIndex === 'number');
  });

  await test('successive adds increment messageIndex per conversation', async () => {
    const rag = createRAG();
    const id1 = await rag.add('первое', { role: 'user', conversationId: 'msgs' });
    const id2 = await rag.add('второе', { role: 'assistant', conversationId: 'msgs' });
    const id3 = await rag.add('третье', { role: 'user', conversationId: 'msgs' });

    assert.equal(rag.chunks.get(id1).meta.messageIndex, 0);
    assert.equal(rag.chunks.get(id2).meta.messageIndex, 1);
    assert.equal(rag.chunks.get(id3).meta.messageIndex, 2);
  });

  await test('different conversations have independent messageIndex', async () => {
    const rag = createRAG();
    const idA1 = await rag.add('a1', { role: 'user', conversationId: 'conv-a' });
    const idB1 = await rag.add('b1', { role: 'user', conversationId: 'conv-b' });
    const idA2 = await rag.add('a2', { role: 'assistant', conversationId: 'conv-a' });

    assert.equal(rag.chunks.get(idA1).meta.messageIndex, 0);
    assert.equal(rag.chunks.get(idB1).meta.messageIndex, 0);
    assert.equal(rag.chunks.get(idA2).meta.messageIndex, 1);
  });

  await test('error on load of non-existent file', async () => {
    const rag = createRAG();
    try {
      await rag.load('./nope.json');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('File not found'));
    }
  });

  console.log(`\n  passed: ${passed}, failed: ${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
