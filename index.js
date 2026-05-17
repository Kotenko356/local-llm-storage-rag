import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { embed as defaultEmbed } from './embedder.js';

const CURRENT_VERSION = 1;

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function generateChunkId() {
  return 'chunk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function generateConversationId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export class LocalRAG {
  constructor({ model = 'nomic-embed-text', embed } = {}) {
    this.model = model;
    this._embed = embed || defaultEmbed;
    this.chunks = new Map();
    this._conversationCounters = {};
  }

  async add(text, meta = {}) {
    const role = meta.role || 'assistant';
    const conversationId = meta.conversationId || generateConversationId();
    const timestamp = meta.timestamp ?? Date.now();
    const messageIndex = meta.messageIndex ?? (this._conversationCounters[conversationId] || 0);

    const id = generateChunkId();

    const vector = await this._embed(text, { model: this.model });

    this.chunks.set(id, {
      v: vector,
      text,
      meta: { ...meta, role, conversationId, timestamp, messageIndex },
    });

    if (meta.messageIndex === undefined) {
      this._conversationCounters[conversationId] = messageIndex + 1;
    }

    return id;
  }

  async search(query, topK = 5) {
    if (this.chunks.size === 0) return [];

    const queryVec = await this._embed(query, { model: this.model });

    const scored = [];
    for (const [id, chunk] of this.chunks) {
      scored.push({
        text: chunk.text,
        similarity: cosineSimilarity(queryVec, chunk.v),
        id,
        meta: chunk.meta,
      });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }

  remove(id) {
    return this.chunks.delete(id);
  }

  removeByConversation(conversationId) {
    let count = 0;
    for (const [id, chunk] of this.chunks) {
      if (chunk.meta.conversationId === conversationId) {
        this.chunks.delete(id);
        count++;
      }
    }
    delete this._conversationCounters[conversationId];
    return count;
  }

  clear() {
    this.chunks.clear();
    this._conversationCounters = {};
  }

  async save(path) {
    const chunks = {};
    for (const [id, chunk] of this.chunks) {
      chunks[id] = chunk;
    }

    const dump = {
      version: CURRENT_VERSION,
      savedAt: new Date().toISOString(),
      model: this.model,
      chunks,
    };

    await writeFile(path, JSON.stringify(dump, null, 2), 'utf-8');
  }

  async load(path) {
    if (!existsSync(path)) {
      throw new Error(`File not found: ${path}`);
    }

    const raw = await readFile(path, 'utf-8');
    const data = JSON.parse(raw);

    if (data.version !== CURRENT_VERSION) {
      throw new Error(
        `Unsupported dump version ${data.version}. Expected ${CURRENT_VERSION}.`
      );
    }

    this.model = data.model || this.model;
    this.chunks = new Map();
    this._conversationCounters = {};

    for (const [id, chunk] of Object.entries(data.chunks || {})) {
      this.chunks.set(id, chunk);

      const cid = chunk.meta?.conversationId;
      const mi = chunk.meta?.messageIndex;
      if (cid != null && mi != null) {
        const current = this._conversationCounters[cid] || 0;
        if (mi >= current) {
          this._conversationCounters[cid] = mi + 1;
        }
      }
    }
  }

  size() {
    return this.chunks.size;
  }
}
