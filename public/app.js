(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RADIUS = 20;
  const HINTS = {
    node: 'Click the board to place a node.',
    edge: 'Click one node, then another, then type the edge weight.',
    move: 'Drag a node to reposition it.',
    erase: 'Click a node or an edge to delete it.',
  };
  const SHORTCUTS = { n: 'node', e: 'edge', m: 'move', x: 'erase' };

  // The example is a classic textbook graph; its minimum spanning tree weighs 39.
  const EXAMPLE = {
    nodes: [
      ['A', 0.08, 0.2], ['B', 0.4, 0.1], ['C', 0.88, 0.2], ['D', 0.18, 0.62],
      ['E', 0.56, 0.5], ['F', 0.4, 0.92], ['G', 0.9, 0.8],
    ],
    edges: [
      ['A', 'B', 7], ['A', 'D', 5], ['B', 'C', 8], ['B', 'D', 9], ['B', 'E', 7], ['C', 'E', 5],
      ['D', 'E', 15], ['D', 'F', 6], ['E', 'F', 8], ['E', 'G', 9], ['F', 'G', 11],
    ],
  };

  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const boardWrap = $('boardWrap');
  const editor = $('weightEditor');
  const runBtn = $('runBtn');
  const playBtn = $('playBtn');
  const scrubber = $('scrubber');
  const statusEl = $('status');

  const state = {
    nodes: [],
    edges: [],
    mode: 'node',
    algorithm: 'kruskal',
    start: '',
    pendingFrom: null,
    pointer: { x: 0, y: 0 },
    dragging: null,
    editing: null,
    result: null,
    step: 0,
    idCounter: 0,
    labelCounter: 0,
    playTimer: null,
  };

  /* ---------- small helpers ---------- */

  const nodeById = (id) => state.nodes.find((n) => n.id === id);
  const edgeById = (id) => state.edges.find((e) => e.id === id);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function labelFor(index) {
    const letter = String.fromCharCode(65 + (index % 26));
    const round = Math.floor(index / 26);
    return round ? `${letter}${round}` : letter;
  }

  function formatWeight(weight) {
    return Number.isInteger(weight) ? String(weight) : String(Number(weight.toFixed(3)));
  }

  function svgEl(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (parent) parent.appendChild(node);
    return node;
  }

  function boardSize() {
    const rect = board.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  function pointerPos(evt) {
    const rect = board.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function say(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle('error', isError);
  }

  async function api(url, options) {
    const res = await fetch(url, options);
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  /* ---------- editing the graph ---------- */

  function stopPlay() {
    if (state.playTimer) clearInterval(state.playTimer);
    state.playTimer = null;
    playBtn.textContent = 'Play steps';
  }

  function clearResult() {
    stopPlay();
    state.result = null;
    state.step = 0;
  }

  function graphChanged() {
    clearResult();
    renderAll();
  }

  function addNode(x, y) {
    const { w, h } = boardSize();
    const clampedX = Math.min(Math.max(x, RADIUS + 4), w - RADIUS - 4);
    const clampedY = Math.min(Math.max(y, RADIUS + 4), h - RADIUS - 4);
    const used = new Set(state.nodes.map((n) => n.label));
    while (used.has(labelFor(state.labelCounter))) state.labelCounter++;
    state.nodes.push({
      id: `n${++state.idCounter}`,
      label: labelFor(state.labelCounter++),
      x: clampedX,
      y: clampedY,
    });
    graphChanged();
  }

  function removeNode(id) {
    state.nodes = state.nodes.filter((n) => n.id !== id);
    state.edges = state.edges.filter((e) => e.from !== id && e.to !== id);
    if (state.pendingFrom === id) state.pendingFrom = null;
    graphChanged();
  }

  function removeEdge(id) {
    state.edges = state.edges.filter((e) => e.id !== id);
    graphChanged();
  }

  function connect(fromId, toId) {
    const existing = state.edges.find(
      (e) => (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId)
    );
    if (existing) {
      say('Those nodes are already connected. Edit the weight instead.');
      return openEditor(existing.id, false);
    }
    const edge = { id: `e${++state.idCounter}`, from: fromId, to: toId, weight: 1 };
    state.edges.push(edge);
    clearResult();
    openEditor(edge.id, true);
  }

  /* ---------- weight editor ---------- */

  function openEditor(edgeId, isNew) {
    if (state.editing) commitEditor();
    const edge = edgeById(edgeId);
    const a = nodeById(edge.from);
    const b = nodeById(edge.to);
    state.editing = { edgeId, isNew };
    editor.value = formatWeight(edge.weight);
    editor.style.left = `${(a.x + b.x) / 2 - 34}px`;
    editor.style.top = `${(a.y + b.y) / 2 - 15}px`;
    editor.hidden = false;
    renderAll();
    // Focus after the pointer's default action, or the click would steal it back.
    setTimeout(() => {
      if (state.editing && state.editing.edgeId === edgeId) {
        editor.focus();
        editor.select();
      }
    }, 0);
  }

  function closeEditor() {
    state.editing = null;
    editor.hidden = true;
  }

  function commitEditor() {
    if (!state.editing) return;
    const { edgeId, isNew } = state.editing;
    const edge = edgeById(edgeId);
    const text = editor.value.trim();
    const value = Number(text);
    closeEditor();
    if (!edge) return renderAll();

    if (text === '' || !Number.isFinite(value)) {
      if (isNew) {
        state.edges = state.edges.filter((e) => e.id !== edgeId);
        say('An edge needs a numeric weight, so it was not added.', true);
      }
      return graphChanged();
    }
    if (!isNew && edge.weight === value) return renderAll();
    edge.weight = value;
    graphChanged();
  }

  function cancelEditor() {
    if (!state.editing) return;
    const { edgeId, isNew } = state.editing;
    closeEditor();
    if (isNew) state.edges = state.edges.filter((e) => e.id !== edgeId);
    graphChanged();
  }

  editor.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') { evt.preventDefault(); commitEditor(); }
    if (evt.key === 'Escape') { evt.preventDefault(); cancelEditor(); }
  });
  editor.addEventListener('blur', commitEditor);

  /* ---------- rendering the board ---------- */

  function edgeStatuses() {
    const status = new Map();
    let current = null;
    if (!state.result) return { status, current };

    const steps = state.result.steps;
    const shown = steps.slice(0, state.step);
    for (const step of shown) status.set(step.edgeId, step.action === 'accept' ? 'mst' : 'skip');

    if (state.step > 0 && state.step < steps.length) current = shown[shown.length - 1].edgeId;
    if (state.step >= steps.length) {
      for (const edge of state.edges) if (!status.has(edge.id)) status.set(edge.id, 'skip');
    }
    return { status, current };
  }

  function renderBoard() {
    boardWrap.dataset.mode = state.mode;
    board.replaceChildren();
    const gEdges = svgEl('g', {}, board);
    const gLabels = svgEl('g', {}, board);
    const gNodes = svgEl('g', {}, board);
    const { status, current } = edgeStatuses();
    const inTree = new Set();
    if (state.result && state.result.startId && state.step > 0) inTree.add(state.result.startId);

    for (const edge of state.edges) {
      const a = nodeById(edge.from);
      const b = nodeById(edge.to);
      if (!a || !b) continue;
      const st = status.get(edge.id) || 'idle';
      if (st === 'mst') { inTree.add(a.id); inTree.add(b.id); }
      const isCurrent = current === edge.id;

      const g = svgEl('g', { class: `edge edge-${st}${isCurrent ? ' edge-current' : ''}` }, gEdges);
      const coords = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      svgEl('line', { ...coords, class: 'edge-hit', 'data-edge': edge.id }, g);
      svgEl('line', { ...coords, class: 'edge-line' }, g);

      if (state.editing && state.editing.edgeId === edge.id) continue; // the input sits here
      const text = formatWeight(edge.weight);
      const width = Math.max(30, text.length * 9 + 16);
      const label = svgEl(
        'g',
        {
          class: `label label-${st}${isCurrent ? ' label-current' : ''}`,
          'data-edge': edge.id,
          transform: `translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`,
        },
        gLabels
      );
      svgEl('rect', { x: -width / 2, y: -12, width, height: 24, rx: 7 }, label);
      const t = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, label);
      t.textContent = text;
    }

    const pending = state.pendingFrom && nodeById(state.pendingFrom);
    if (pending) {
      svgEl('line', { x1: pending.x, y1: pending.y, x2: state.pointer.x, y2: state.pointer.y, class: 'rubber' }, gEdges);
    }

    for (const node of state.nodes) {
      const cls = `node${inTree.has(node.id) ? ' node-in' : ''}${state.pendingFrom === node.id ? ' node-pending' : ''}`;
      const g = svgEl('g', { class: cls, 'data-node': node.id, transform: `translate(${node.x} ${node.y})` }, gNodes);
      svgEl('circle', { r: RADIUS }, g);
      const t = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = node.label;
    }
  }

  /* ---------- rendering the side panel ---------- */

  function renderPanel() {
    document.querySelectorAll('[data-mode]').forEach((btn) => {
      if (btn.tagName === 'BUTTON') btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
    });
    document.querySelectorAll('[data-algo]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.algo === state.algorithm));
    });

    $('startRow').hidden = state.algorithm !== 'prim';
    const select = $('startSelect');
    select.replaceChildren(
      new Option('First node drawn', ''),
      ...state.nodes.map((n) => new Option(n.label, n.id))
    );
    if (!nodeById(state.start)) state.start = '';
    select.value = state.start;

    $('counts').textContent = `${plural(state.nodes.length, 'node')}, ${plural(state.edges.length, 'edge')}`;
    $('hint').textContent = HINTS[state.mode];
    $('emptyMessage').hidden = state.nodes.length > 0;
    runBtn.disabled = state.nodes.length === 0;
    renderResult();
  }

  function renderResult() {
    const result = state.result;
    $('resultSection').hidden = !result;
    if (!result) return;

    const steps = result.steps;
    $('total').textContent = formatWeight(result.totalWeight);

    const n = state.nodes.length;
    if (n === 1) $('resultNote').textContent = 'A single node needs no edges.';
    else if (result.connected) {
      $('resultNote').textContent = `${plural(result.mstEdgeIds.length, 'edge')} connect all ${n} nodes.`;
    } else {
      $('resultNote').textContent =
        `The graph has ${result.components} separate parts, so this is a spanning forest of ` +
        `${plural(result.mstEdgeIds.length, 'edge')}.`;
    }

    scrubber.max = String(steps.length);
    scrubber.value = String(state.step);
    scrubber.disabled = steps.length === 0;
    playBtn.disabled = steps.length === 0;
    $('scrubLabel').textContent = `Step ${state.step} of ${steps.length}`;

    const labelOf = (id) => (nodeById(id) ? nodeById(id).label : id);
    $('stepList').replaceChildren(
      ...steps.map((step, i) => {
        const edge = edgeById(step.edgeId);
        const li = document.createElement('li');
        li.className = `${step.action}${i === state.step - 1 ? ' active' : ''}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        const head = document.createElement('span');
        head.className = 'head';
        head.textContent = `${labelOf(edge.from)}\u2013${labelOf(edge.to)}, weight ${formatWeight(edge.weight)}`;
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = `${step.action === 'accept' ? 'Added' : 'Skipped'}: ${step.note.toLowerCase()}`;
        btn.append(head, note);
        btn.addEventListener('click', () => goToStep(i + 1));
        li.appendChild(btn);
        return li;
      })
    );
  }

  function renderAll() {
    renderBoard();
    renderPanel();
  }

  function goToStep(step) {
    stopPlay();
    state.step = step;
    renderBoard();
    renderResult();
  }

  /* ---------- pointer input on the board ---------- */

  board.addEventListener('pointerdown', (evt) => {
    if (evt.pointerType === 'mouse' && evt.button !== 0) return;
    const p = pointerPos(evt);
    const nodeEl = evt.target.closest('[data-node]');
    const edgeEl = evt.target.closest('[data-edge]');

    if (nodeEl) return onNodeDown(nodeEl.dataset.node, p);
    if (edgeEl) return onEdgeDown(edgeEl.dataset.edge, Boolean(evt.target.closest('.label')));
    onEmptyDown(p);
  });

  function onNodeDown(id, p) {
    if (state.mode === 'edge') {
      if (!state.pendingFrom) {
        state.pendingFrom = id;
        state.pointer = p;
        renderBoard();
      } else if (state.pendingFrom === id) {
        state.pendingFrom = null;
        renderBoard();
      } else {
        const from = state.pendingFrom;
        state.pendingFrom = null;
        connect(from, id);
      }
    } else if (state.mode === 'move') {
      const node = nodeById(id);
      state.dragging = { id, dx: node.x - p.x, dy: node.y - p.y };
    } else if (state.mode === 'erase') {
      removeNode(id);
    }
  }

  function onEdgeDown(id, onLabel) {
    if (state.mode === 'erase') removeEdge(id);
    else if (onLabel) openEditor(id, false);
  }

  function onEmptyDown(p) {
    if (state.mode === 'node') addNode(p.x, p.y);
    else if (state.pendingFrom) {
      state.pendingFrom = null;
      renderBoard();
    }
  }

  window.addEventListener('pointermove', (evt) => {
    if (state.dragging) {
      const p = pointerPos(evt);
      const node = nodeById(state.dragging.id);
      const { w, h } = boardSize();
      node.x = Math.min(Math.max(p.x + state.dragging.dx, RADIUS), w - RADIUS);
      node.y = Math.min(Math.max(p.y + state.dragging.dy, RADIUS), h - RADIUS);
      renderBoard();
    } else if (state.pendingFrom) {
      state.pointer = pointerPos(evt);
      renderBoard();
    }
  });

  function endDrag() {
    state.dragging = null;
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  document.addEventListener('keydown', (evt) => {
    if (evt.target.closest('input, select, textarea') || evt.ctrlKey || evt.metaKey || evt.altKey) return;
    if (evt.key === 'Escape' && state.pendingFrom) {
      state.pendingFrom = null;
      renderBoard();
    } else if (SHORTCUTS[evt.key.toLowerCase()]) {
      setMode(SHORTCUTS[evt.key.toLowerCase()]);
    }
  });

  window.addEventListener('resize', renderBoard);

  /* ---------- panel controls ---------- */

  function setMode(mode) {
    state.mode = mode;
    state.pendingFrom = null;
    renderAll();
  }

  document.querySelectorAll('button[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  document.querySelectorAll('[data-algo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.algorithm = btn.dataset.algo;
      graphChanged();
    });
  });

  $('startSelect').addEventListener('change', (evt) => {
    state.start = evt.target.value;
    graphChanged();
  });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    say('Working it out on the server...');
    try {
      const result = await api('/api/mst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          algorithm: state.algorithm,
          start: state.start,
          nodes: state.nodes.map(({ id, label }) => ({ id, label })),
          edges: state.edges.map(({ id, from, to, weight }) => ({ id, from, to, weight })),
        }),
      });
      stopPlay();
      state.result = result;
      state.step = result.steps.length;
      renderAll();
      say(
        result.connected || state.nodes.length === 1
          ? `Minimum spanning tree found. Total weight ${formatWeight(result.totalWeight)}.`
          : `Graph is not connected. Showing a spanning forest of weight ${formatWeight(result.totalWeight)}.`
      );
    } catch (err) {
      say(err.message, true);
    } finally {
      runBtn.disabled = state.nodes.length === 0;
    }
  });

  scrubber.addEventListener('input', () => goToStep(Number(scrubber.value)));

  playBtn.addEventListener('click', () => {
    if (state.playTimer) {
      stopPlay();
      return;
    }
    const total = state.result.steps.length;
    if (state.step >= total) state.step = 0;
    playBtn.textContent = 'Pause';
    state.playTimer = setInterval(() => {
      state.step += 1;
      renderBoard();
      renderResult();
      if (state.step >= total) stopPlay();
    }, 800);
    renderBoard();
    renderResult();
  });

  /* ---------- loading graphs onto the board ---------- */

  function fitToBoard(nodes) {
    if (nodes.length === 0) return;
    const pad = RADIUS + 28;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const { w, h } = boardSize();
    const scale = Math.min(1, (w - 2 * pad) / Math.max(maxX - minX, 1), (h - 2 * pad) / Math.max(maxY - minY, 1));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    for (const n of nodes) {
      n.x = w / 2 + (n.x - cx) * scale;
      n.y = h / 2 + (n.y - cy) * scale;
    }
  }

  function setGraph(nodes, edges) {
    closeEditor();
    state.pendingFrom = null;
    state.nodes = nodes.map((n) => ({ ...n }));
    state.edges = edges.map((e) => ({ ...e }));
    fitToBoard(state.nodes);
    const numbers = [...state.nodes, ...state.edges].map((item) => Number(item.id.replace(/\D/g, '')) || 0);
    state.idCounter = Math.max(0, ...numbers);
    state.labelCounter = state.nodes.length;
    graphChanged();
  }

  $('exampleBtn').addEventListener('click', () => {
    const { w, h } = boardSize();
    const pad = RADIUS + 28;
    const idByLabel = {};
    const nodes = EXAMPLE.nodes.map(([label, fx, fy], i) => {
      idByLabel[label] = `n${i + 1}`;
      return { id: `n${i + 1}`, label, x: pad + fx * (w - 2 * pad), y: pad + fy * (h - 2 * pad) };
    });
    const edges = EXAMPLE.edges.map(([a, b, weight], i) => ({
      id: `e${nodes.length + i + 1}`,
      from: idByLabel[a],
      to: idByLabel[b],
      weight,
    }));
    setGraph(nodes, edges);
    say('Example loaded. Press "Find minimum spanning tree".');
  });

  $('clearBtn').addEventListener('click', () => {
    if (state.nodes.length > 0 && !window.confirm('Remove every node and edge from the board?')) return;
    closeEditor();
    state.nodes = [];
    state.edges = [];
    state.pendingFrom = null;
    state.labelCounter = 0;
    say('');
    graphChanged();
  });

  /* ---------- saved graphs ---------- */

  async function refreshSaved() {
    const list = $('savedList');
    try {
      const graphs = await api('/api/graphs');
      $('savedEmpty').textContent = 'Nothing saved yet.';
      $('savedEmpty').hidden = graphs.length > 0;
      list.replaceChildren(
        ...graphs.map((g) => {
          const li = document.createElement('li');
          const load = document.createElement('button');
          load.type = 'button';
          load.className = 'load';
          const name = document.createElement('span');
          name.textContent = g.name;
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = `${plural(g.nodeCount, 'node')}, ${plural(g.edgeCount, 'edge')}`;
          load.append(name, meta);
          load.addEventListener('click', () => loadSaved(g.id));

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'remove';
          remove.textContent = 'Delete';
          remove.setAttribute('aria-label', `Delete ${g.name}`);
          remove.addEventListener('click', () => deleteSaved(g.id, g.name));

          li.append(load, remove);
          return li;
        })
      );
    } catch (err) {
      $('savedEmpty').hidden = false;
      $('savedEmpty').textContent = 'Could not reach the server to list saved graphs.';
    }
  }

  async function loadSaved(id) {
    try {
      const graph = await api(`/api/graphs/${id}`);
      setGraph(graph.nodes, graph.edges);
      say(`Loaded "${graph.name}".`);
    } catch (err) {
      say(err.message, true);
    }
  }

  async function deleteSaved(id, name) {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await api(`/api/graphs/${id}`, { method: 'DELETE' });
      refreshSaved();
    } catch (err) {
      say(err.message, true);
    }
  }

  $('saveForm').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (state.nodes.length === 0) return say('Draw something before saving.', true);
    const input = $('saveName');
    const name = input.value.trim() || 'Untitled graph';
    try {
      await api('/api/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          nodes: state.nodes.map(({ id, label, x, y }) => ({ id, label, x, y })),
          edges: state.edges.map(({ id, from, to, weight }) => ({ id, from, to, weight })),
        }),
      });
      input.value = '';
      say(`Saved "${name}".`);
      refreshSaved();
    } catch (err) {
      say(err.message, true);
    }
  });

  /* ---------- start ---------- */

  renderAll();
  refreshSaved();
})();
