'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server');

const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mst-')), 'graphs.json');
const server = createServer({ dataFile });
let base;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = (url, body) =>
  fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const triangle = {
  nodes: [
    { id: 'n1', label: 'A', x: 10, y: 10 },
    { id: 'n2', label: 'B', x: 90, y: 10 },
    { id: 'n3', label: 'C', x: 50, y: 80 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', weight: 4 },
    { id: 'e2', from: 'n2', to: 'n3', weight: 1 },
    { id: 'e3', from: 'n1', to: 'n3', weight: 2 },
  ],
};

test('serves the web page and its assets', async () => {
  for (const [url, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css']]) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), new RegExp(type));
  }
});

test('blocks path traversal', async () => {
  const res = await fetch(`${base}/..%2Fserver.js`);
  assert.notEqual(res.status, 200);
});

test('POST /api/mst returns the tree and replay steps', async () => {
  const res = await post('/api/mst', { ...triangle, algorithm: 'kruskal' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totalWeight, 3);
  assert.deepEqual(new Set(body.mstEdgeIds), new Set(['e2', 'e3']));
  assert.equal(body.steps.length, 2); // Kruskal stops once the tree is complete
});

test('POST /api/mst validates its input', async () => {
  assert.equal((await post('/api/mst', { nodes: 'no', edges: [] })).status, 400);
  assert.equal((await post('/api/mst', { ...triangle, algorithm: 'dijkstra' })).status, 400);
  assert.equal((await post('/api/mst', { ...triangle, algorithm: 'prim', start: 'zzz' })).status, 400);
  const bad = await fetch(base + '/api/mst', { method: 'POST', body: '{oops' });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(base + '/api/mst')).status, 405);
});

test('save, list, load and delete a graph', async () => {
  const saved = await post('/api/graphs', { name: 'Triangle', ...triangle });
  assert.equal(saved.status, 201);
  const { id } = await saved.json();

  const list = await (await fetch(base + '/api/graphs')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Triangle');
  assert.equal(list[0].nodeCount, 3);

  const loaded = await (await fetch(`${base}/api/graphs/${id}`)).json();
  assert.equal(loaded.edges.length, 3);

  assert.equal((await fetch(`${base}/api/graphs/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/graphs/${id}`)).status, 404);
  assert.equal((await (await fetch(base + '/api/graphs')).json()).length, 0);
});

test('saving requires a name and node positions', async () => {
  assert.equal((await post('/api/graphs', { ...triangle })).status, 400);
  const noPos = { name: 'x', nodes: [{ id: 'a' }], edges: [] };
  assert.equal((await post('/api/graphs', noPos)).status, 400);
});
