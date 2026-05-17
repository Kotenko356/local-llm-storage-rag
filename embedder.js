const OLLAMA_URL = 'http://localhost:11434/api/embed';

const DEFAULT_TIMEOUT = 10_000;

export async function embed(text, { model = 'nomic-embed-text', timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const vec = data.embeddings?.[0];

    if (!vec) {
      throw new Error('Ollama returned empty embeddings');
    }

    return vec;
  } finally {
    clearTimeout(timer);
  }
}
