// ── State ──────────────────────────────────────────────────

let state = {
  path: localStorage.getItem('ragPath') || '',
  loaded: false,
  chunks: [],
  conversations: [],
  selectedChunkId: null,
};

const DB = window.__TAURI__;

// ── Invoke helper ─────────────────────────────────────────

async function cmd(name, args = {}) {
  if (!DB) throw new Error('Not running in Tauri');
  return DB.core.invoke(name, args);
}

// ── DOM refs ──────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const dumpPath = $('dump-path');
const statusBar = $('status-bar');
const statusMsg = $('status-msg');
const dashboard = $('dashboard');
const tabs = $('tabs');
const actions = $('actions');

// ── Status ────────────────────────────────────────────────

function setStatus(msg, type = 'ok') {
  statusBar.classList.remove('hidden', 'ok', 'err');
  statusBar.classList.add(type);
  statusMsg.textContent = msg;
}

function clearStatus() {
  statusBar.classList.add('hidden');
}

// ── Load dump ─────────────────────────────────────────────

async function loadDump(path) {
  try {
    clearStatus();

    const exists = await cmd('dump_exists', { path });
    if (!exists) {
      setStatus(`Файл не найден: ${path}`, 'err');
      return;
    }

    const stats = await cmd('read_stats', { path });

    $('stat-chunks').textContent = stats.chunkCount.toLocaleString();
    $('stat-convs').textContent = stats.conversationCount.toLocaleString();
    $('stat-ram').textContent = formatRam(stats.estimatedRamKb);
    $('stat-version').textContent = `v${stats.version}`;
    $('stat-saved-at').textContent = stats.savedAt || '—';

    dashboard.classList.remove('hidden');
    tabs.classList.remove('hidden');
    actions.classList.remove('hidden');

    state.path = path;
    state.loaded = true;
    localStorage.setItem('ragPath', path);

    setStatus(`Загружено: ${stats.chunkCount} чанков, ${stats.conversationCount} диалогов`);
    await loadConversations(path);
  } catch (err) {
    setStatus(err, 'err');
  }
}

function formatRam(kb) {
  if (kb < 1024) return `${kb} KB`;
  const mb = (kb / 1024).toFixed(1);
  return `${mb} MB`;
}

// ── Search ────────────────────────────────────────────────

async function doSearch() {
  const query = $('search-query').value.trim();
  const role = $('search-role').value;
  const convId = $('search-conv').value.trim();

  if (!state.loaded) return;

  try {
    let results;
    if (query) {
      results = await cmd('search_chunks', { path: state.path, query, topK: 100 });
    } else {
      results = state.chunks;
    }

    // Client-side filters
    if (role) {
      results = results.filter(r => r.role === role);
    }
    if (convId) {
      results = results.filter(r => r.conversationId && r.conversationId.includes(convId));
    }

    renderResults(results);
  } catch (err) {
    setStatus(err, 'err');
  }
}

function renderResults(results) {
  const container = $('search-results');
  const count = $('result-count');

  if (results.length === 0) {
    container.innerHTML = '<div class="placeholder">Ничего не найдено</div>';
    count.classList.add('hidden');
    return;
  }

  count.classList.remove('hidden');
  count.textContent = `${results.length} чанков`;

  container.innerHTML = results.map(r => {
    const roleClass = `role-${r.role}`;
    const conv = r.conversationId ? `cid: ${r.conversationId}` : '';
    const ts = r.timestamp ? new Date(r.timestamp).toLocaleString() : '';
    const sim = r.similarity < 1 ? `<span class="chunk-sim">${(r.similarity * 100).toFixed(0)}%</span>` : '';
    const selected = r.id === state.selectedChunkId ? 'selected' : '';

    return `
      <div class="chunk-row ${selected}" data-id="${r.id}">
        ${sim}
        <div><span class="chunk-role ${roleClass}">${r.role}</span></div>
        <div class="chunk-text">${escapeHtml(r.text)}</div>
        <div class="chunk-meta">${r.id} ${conv ? '— ' + conv : ''} ${ts ? '— ' + ts : ''}</div>
      </div>
    `;
  }).join('');

  // Click handler for selecting chunks
  container.querySelectorAll('.chunk-row').forEach(el => {
    el.addEventListener('click', () => {
      container.querySelectorAll('.chunk-row').forEach(r => r.classList.remove('selected'));
      el.classList.add('selected');
      state.selectedChunkId = el.dataset.id;
      $('graph-chunk-id').value = el.dataset.id;
    });
  });
}

// ── Conversations ─────────────────────────────────────────

async function loadConversations(path) {
  try {
    const convs = await cmd('list_conversations', { path });
    state.conversations = convs;
    renderConversations(convs);
  } catch (err) {
    console.error('loadConversations:', err);
  }
}

function renderConversations(convs) {
  const container = $('conv-list');

  if (convs.length === 0) {
    container.innerHTML = '<div class="placeholder">Нет диалогов</div>';
    return;
  }

  container.innerHTML = convs.map(c => {
    const roles = c.roles.map(r => {
      const cls = `role-${r}`;
      return `<span class="chunk-role ${cls}">${r}</span>`;
    }).join('');
    const ts = c.lastTs ? new Date(c.lastTs).toLocaleString() : '';

    return `
      <div class="conv-row">
        <div>
          <div class="conv-id">${escapeHtml(c.id)}</div>
          <div class="conv-count">${c.chunkCount} сообщений</div>
        </div>
        <div class="conv-roles">${roles} ${ts ? '<span style="color:var(--text-dim);font-size:11px">' + ts + '</span>' : ''}</div>
      </div>
    `;
  }).join('');
}

// ── Graph ─────────────────────────────────────────────────

let graphNodes = [];
let graphEdges = [];
let graphAnimationId = null;

async function buildGraph() {
  const chunkId = $('graph-chunk-id').value.trim();
  const threshold = parseFloat($('graph-threshold').value);

  if (!chunkId || !state.loaded) return;

  try {
    const related = await cmd('get_related', {
      path: state.path,
      chunkId,
      threshold,
      topK: 20,
    });

    // Central node + related nodes
    graphNodes = [{ id: chunkId, label: chunkId.slice(0, 12), isCenter: true }];
    graphEdges = [];

    related.forEach(r => {
      graphNodes.push({ id: r.id, label: r.id.slice(0, 12), role: r.role, sim: r.similarity });
      graphEdges.push({ from: chunkId, to: r.id, weight: r.similarity });
    });

    // Remove duplicates
    const seen = new Set();
    graphNodes = graphNodes.filter(n => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    const legend = $('graph-legend');
    legend.classList.remove('hidden');
    legend.innerHTML = `Центр: <strong>${chunkId}</strong> | Порог: ${threshold} | Связей: ${related.length}`;

    drawGraph();
  } catch (err) {
    setStatus(err, 'err');
  }
}

function drawGraph() {
  const canvas = $('graph-canvas');
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = 450;

  if (graphNodes.length === 0) return;

  const w = canvas.width;
  const h = canvas.height;

  // Init positions
  const center = graphNodes.find(n => n.isCenter);
  const others = graphNodes.filter(n => !n.isCenter);

  if (!graphNodes.some(n => n.x !== undefined)) {
    const cx = w / 2, cy = h / 2;
    if (center) { center.x = cx; center.y = cy; }
    others.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / others.length;
      const radius = Math.min(w, h) * 0.32;
      n.x = cx + radius * Math.cos(angle);
      n.y = cy + radius * Math.sin(angle);
    });
  }

  // Simple force layout (one iteration per frame)
  function iterate() {
    const cx = w / 2, cy = h / 2;

    // Center pull for center node
    if (center) {
      center.x += (cx - center.x) * 0.02;
      center.y += (cy - center.y) * 0.02;
    }

    // Repulsion between all nodes
    for (let i = 0; i < graphNodes.length; i++) {
      for (let j = i + 1; j < graphNodes.length; j++) {
        const a = graphNodes[i], b = graphNodes[j];
        if (a.isCenter && b.isCenter) continue;
        let dx = (b.x || 0) - (a.x || 0);
        let dy = (b.y || 0) - (a.y || 0);
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 2000 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.isCenter) { a.x -= fx; a.y -= fy; }
        if (!b.isCenter) { b.x += fx; b.y += fy; }
      }
    }

    // Edge attraction
    for (const edge of graphEdges) {
      const from = graphNodes.find(n => n.id === edge.from);
      const to = graphNodes.find(n => n.id === edge.to);
      if (!from || !to) continue;
      const dx = (to.x || 0) - (from.x || 0);
      const dy = (to.y || 0) - (from.y || 0);
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = dist * 0.005;
      if (!from.isCenter) { from.x += dx * force; from.y += dy * force; }
      if (!to.isCenter) { to.x -= dx * force; to.y -= dy * force; }
    }
  }

  function render() {
    ctx.clearRect(0, 0, w, h);

    // Edges
    for (const edge of graphEdges) {
      const from = graphNodes.find(n => n.id === edge.from);
      const to = graphNodes.find(n => n.id === edge.to);
      if (!from || !to) continue;
      const alpha = Math.max(edge.weight * 0.6, 0.1);
      ctx.strokeStyle = `rgba(88, 166, 255, ${alpha})`;
      ctx.lineWidth = edge.weight * 2;
      ctx.beginPath();
      ctx.moveTo(from.x || 0, from.y || 0);
      ctx.lineTo(to.x || 0, to.y || 0);
      ctx.stroke();
    }

    // Nodes
    for (const node of graphNodes) {
      const x = node.x || 0, y = node.y || 0;
      const r = node.isCenter ? 8 : 5;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);

      if (node.isCenter) {
        ctx.fillStyle = '#f0883e';
      } else if (node.role === 'user') {
        ctx.fillStyle = '#58a6ff';
      } else if (node.role === 'assistant') {
        ctx.fillStyle = '#3fb950';
      } else {
        ctx.fillStyle = '#d2a8ff';
      }
      ctx.fill();

      if (node.isCenter) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = '#8b949e';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, x, y + r + 14);
    }
  }

  // Animate
  if (graphAnimationId) cancelAnimationFrame(graphAnimationId);

  let frames = 0;
  function animate() {
    if (frames < 60) { // ~1 second of animation
      iterate();
      frames++;
    }
    render();
    graphAnimationId = requestAnimationFrame(animate);
  }
  animate();
}

// ── Backup & Clear ────────────────────────────────────────

async function backupAndClear() {
  if (!state.loaded) return;
  if (!confirm('Создать бэкап и очистить дамп? Это действие необратимо без ручного восстановления из .bak файла.')) return;

  try {
    await cmd('backup_and_clear', { path: state.path });
    setStatus('Дамп очищен. Бэкап: ' + state.path + '.bak');
    await loadDump(state.path);
  } catch (err) {
    setStatus(err, 'err');
  }
}

// ── Refresh ───────────────────────────────────────────────

async function refresh() {
  if (state.path) {
    await loadDump(state.path);
  }
}

// ── Tab switching ─────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');

    // Resize graph canvas on switch
    if (tab.dataset.tab === 'graph' && graphNodes.length > 0) {
      setTimeout(drawGraph, 50);
    }
  });
});

// ── Event listeners ───────────────────────────────────────

$('btn-load').addEventListener('click', () => loadDump(dumpPath.value.trim()));

dumpPath.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadDump(dumpPath.value.trim());
});

$('btn-refresh').addEventListener('click', refresh);
$('btn-clear').addEventListener('click', backupAndClear);
$('btn-search').addEventListener('click', doSearch);
$('btn-build-graph').addEventListener('click', buildGraph);
$('graph-threshold').addEventListener('input', () => {
  $('graph-threshold-val').textContent = $('graph-threshold').value;
});

// Search on Enter
$('search-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

// Browse
$('btn-browse').addEventListener('click', async () => {
  if (!DB) return;
  try {
    const selected = await cmd('open_dialog', {
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (selected) {
      const p = typeof selected === 'string' ? selected : selected.path || selected;
      dumpPath.value = p;
      await loadDump(p);
    }
  } catch (err) {
    // dialog plugin might not be exposed directly this way;
    // try fallback using the dialog plugin
    try {
      const { open } = window.__TAURI__.dialog;
      const selected = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (selected) {
        dumpPath.value = selected;
        await loadDump(selected);
      }
    } catch (e2) {
      setStatus('Диалог выбора файла недоступен. Введите путь вручную.', 'err');
    }
  }
});

// ── Init ──────────────────────────────────────────────────

(function init() {
  if (state.path) {
    dumpPath.value = state.path;
    loadDump(state.path);
  } else {
    dumpPath.value = '.kilo/rag-context.json';
  }
})();

// ── Utils ─────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
